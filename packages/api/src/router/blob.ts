import { TRPCError } from "@trpc/server";
import { put } from "@vercel/blob";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "../trpc";

const SVG_MAX_SIZE_BYTES = 100 * 1024; // 100KB
const IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;
const IMAGE_MAX_BASE64_LENGTH = Math.ceil((IMAGE_MAX_SIZE_BYTES * 4) / 3) + 4;

const imageSignatures = {
  ".ico": (buffer: Buffer) =>
    buffer.length >= 4 &&
    buffer[0] === 0x00 &&
    buffer[1] === 0x00 &&
    buffer[2] === 0x01 &&
    buffer[3] === 0x00,
  ".jpg": (buffer: Buffer) =>
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff,
  ".jpeg": (buffer: Buffer) =>
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff,
  ".png": (buffer: Buffer) =>
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  ".webp": (buffer: Buffer) =>
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP",
} as const;

export function isSvgFile(filename: string): boolean {
  return filename.toLowerCase().endsWith(".svg");
}

export function hasValidRasterImageSignature(
  filename: string,
  buffer: Buffer,
): boolean {
  const lowerFilename = filename.toLowerCase();
  const extension = Object.keys(imageSignatures).find((candidate) =>
    lowerFilename.endsWith(candidate),
  ) as keyof typeof imageSignatures | undefined;
  return extension ? imageSignatures[extension](buffer) : false;
}

export async function sanitizeSvg(svgContent: string): Promise<string> {
  // Lazy import because root.ts merges edge + lambda routers,
  // so this module is evaluated in both runtimes — jsdom can't load on edge
  const { default: DOMPurify } = await import("isomorphic-dompurify");
  return DOMPurify.sanitize(svgContent, {
    USE_PROFILES: { svg: true, svgFilters: true },
    // DOMPurify's SVG profile strips all on* event handlers by default.
    // We explicitly forbid foreignObject (can embed arbitrary HTML),
    // and script (direct code execution).
    // FORBID_CONTENTS ensures text inside forbidden tags is also removed
    // (e.g. alert(...) text from <script> won't leak into the output).
    FORBID_TAGS: ["foreignObject", "script"],
    FORBID_CONTENTS: ["foreignObject", "script"],
  });
}

export const blobRouter = createTRPCRouter({
  upload: protectedProcedure
    .input(
      z.object({
        filename: z.string().min(1),
        // Base64 encoded string (without data: prefix)
        file: z.string().min(1).max(IMAGE_MAX_BASE64_LENGTH),
      }),
    )
    .mutation(async (opts) => {
      const { filename, file } = opts.input;

      // If the client sent a data URL, strip the prefix
      const base64 = file.includes("base64,")
        ? file.split("base64,").pop()
        : file;

      if (!base64) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid file",
        });
      }

      let buffer = Buffer.from(base64, "base64");

      if (buffer.byteLength > IMAGE_MAX_SIZE_BYTES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Image file must be under 5MB",
        });
      }

      if (isSvgFile(filename)) {
        if (buffer.byteLength > SVG_MAX_SIZE_BYTES) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "SVG file must be under 100KB",
          });
        }

        const sanitized = await sanitizeSvg(buffer.toString("utf-8"));
        if (!sanitized.trim()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "SVG file contains no valid content after sanitization",
          });
        }
        const sanitizedBuffer = Buffer.from(sanitized, "utf-8");
        if (sanitizedBuffer.byteLength > SVG_MAX_SIZE_BYTES) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "SVG file must be under 100KB",
          });
        }
        buffer = sanitizedBuffer;
      } else if (!hasValidRasterImageSignature(filename, buffer)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only PNG, JPEG, WebP, ICO, and SVG images are supported",
        });
      }

      const blob = await put(`${opts.ctx.workspace.slug}/${filename}`, buffer, {
        access: "public",
        addRandomSuffix: true,
      });

      return blob;
    }),
});
