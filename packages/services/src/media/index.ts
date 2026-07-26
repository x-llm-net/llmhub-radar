import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { resolve, sep } from "node:path";

import { and, count, db, eq, gt, inArray, isNull, lt } from "@openstatus/db";
import {
  mediaAsset,
  mediaPurposes,
  radarClaimApplicationEvidence,
  radarOrder,
} from "@openstatus/db/src/schema";

import {
  type ServiceContext,
  getReadDb,
  tryGetActorUserId,
  withTransaction,
} from "../context";
import {
  ConflictError,
  ForbiddenError,
  InternalServiceError,
  LimitExceededError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../errors";
import { getRadarActorAccess } from "../radar/access";

export type MediaPurpose = (typeof mediaPurposes)[number];

type MediaPolicy = {
  maxBytes: number;
  allowedMimeTypes: readonly string[];
  visibility: "private" | "public";
  temporaryLifetimeMs: number;
};

const MEDIA_POLICIES: Record<MediaPurpose, MediaPolicy> = {
  claim_evidence: {
    maxBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    visibility: "private",
    temporaryLifetimeMs: 24 * 60 * 60 * 1000,
  },
  order_receipt: {
    maxBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    visibility: "private",
    temporaryLifetimeMs: 24 * 60 * 60 * 1000,
  },
};

const MAX_ACTIVE_TEMPORARY_ASSETS_PER_USER = 12;
const CLEANUP_BATCH_SIZE = 20;

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function getActorUserId(ctx: ServiceContext) {
  const userId = tryGetActorUserId(ctx.actor);
  if (userId == null) {
    throw new UnauthorizedError("A signed-in user is required.");
  }
  return userId;
}

function getStorageRoot() {
  const configured = process.env.MEDIA_STORAGE_ROOT?.trim();
  if (!configured) {
    throw new InternalServiceError("Media storage is not configured.");
  }
  return resolve(configured);
}

function resolveStoragePath(storageKey: string) {
  const root = getStorageRoot();
  const path = resolve(root, storageKey);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new InternalServiceError("Invalid media storage key.");
  }
  return path;
}

function normalizeFilename(filename: string) {
  const parts = filename.split(/[\\/]/);
  const leaf = parts[parts.length - 1] ?? "upload";
  const normalized = Array.from(leaf)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 0x1f && codePoint !== 0x7f;
    })
    .join("")
    .trim();
  return (normalized || "upload").slice(0, 255);
}

export function detectMediaMimeType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function publicAsset(asset: typeof mediaAsset.$inferSelect) {
  return {
    id: asset.id,
    url: `/api/media/${asset.id}`,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
  };
}

async function removeStoredFile(storageKey: string) {
  try {
    await unlink(resolveStoragePath(storageKey));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[media] failed to remove stored file", storageKey, error);
    }
  }
}

async function cleanupExpiredTemporaryAssets(ctx: ServiceContext) {
  const expired = await withTransaction(ctx, async (tx) => {
    const now = new Date();
    const rows = await tx
      .select({ id: mediaAsset.id, storageKey: mediaAsset.storageKey })
      .from(mediaAsset)
      .leftJoin(
        radarClaimApplicationEvidence,
        eq(radarClaimApplicationEvidence.assetId, mediaAsset.id),
      )
      .leftJoin(radarOrder, eq(radarOrder.receiptAssetId, mediaAsset.id))
      .where(
        and(
          lt(mediaAsset.expiresAt, now),
          isNull(radarClaimApplicationEvidence.assetId),
          isNull(radarOrder.id),
        ),
      )
      .limit(CLEANUP_BATCH_SIZE)
      .all();

    if (rows.length > 0) {
      await tx.delete(mediaAsset).where(
        inArray(
          mediaAsset.id,
          rows.map((row) => row.id),
        ),
      );
    }
    return rows;
  });

  await Promise.all(expired.map((asset) => removeStoredFile(asset.storageKey)));
}

export async function createMediaAsset(args: {
  ctx: ServiceContext;
  input: {
    purpose: MediaPurpose;
    originalFilename: string;
    declaredMimeType: string;
    bytes: Uint8Array;
  };
}) {
  const userId = getActorUserId(args.ctx);
  const policy = MEDIA_POLICIES[args.input.purpose];
  if (!policy) throw new ValidationError("Unsupported media purpose.");
  if (args.input.bytes.byteLength === 0) {
    throw new ValidationError("The uploaded file is empty.");
  }
  if (args.input.bytes.byteLength > policy.maxBytes) {
    throw new LimitExceededError("media file size", policy.maxBytes);
  }

  const detectedMimeType = detectMediaMimeType(args.input.bytes);
  if (
    !detectedMimeType ||
    !policy.allowedMimeTypes.includes(detectedMimeType) ||
    args.input.declaredMimeType !== detectedMimeType
  ) {
    throw new ValidationError("The uploaded file type is not supported.");
  }

  await cleanupExpiredTemporaryAssets(args.ctx);

  const id = randomUUID();
  const extension = MIME_EXTENSIONS[detectedMimeType];
  if (!extension) throw new ValidationError("Unsupported media type.");
  const storageKey = `${args.input.purpose}/${id}.${extension}`;
  const finalPath = resolveStoragePath(storageKey);
  const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;
  await mkdir(resolveStoragePath(args.input.purpose), {
    recursive: true,
    mode: 0o700,
  });

  try {
    await writeFile(temporaryPath, args.input.bytes, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, finalPath);
    await chmod(finalPath, 0o600);

    const now = new Date();
    const asset = await withTransaction(args.ctx, async (tx) => {
      const active = await tx
        .select({ count: count() })
        .from(mediaAsset)
        .where(
          and(
            eq(mediaAsset.ownerUserId, userId),
            gt(mediaAsset.expiresAt, now),
          ),
        )
        .get();
      if ((active?.count ?? 0) >= MAX_ACTIVE_TEMPORARY_ASSETS_PER_USER) {
        throw new LimitExceededError(
          "temporary media asset",
          MAX_ACTIVE_TEMPORARY_ASSETS_PER_USER,
        );
      }

      return tx
        .insert(mediaAsset)
        .values({
          id,
          workspaceId: args.ctx.workspace.id,
          ownerUserId: userId,
          purpose: args.input.purpose,
          visibility: policy.visibility,
          storageKey,
          originalFilename: normalizeFilename(args.input.originalFilename),
          mimeType: detectedMimeType,
          sizeBytes: args.input.bytes.byteLength,
          expiresAt: new Date(now.getTime() + policy.temporaryLifetimeMs),
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
    });

    return publicAsset(asset);
  } catch (error) {
    await removeStoredFile(storageKey);
    try {
      await unlink(temporaryPath);
    } catch {}
    throw error;
  }
}

export async function getMediaAssetForRead(args: {
  ctx: ServiceContext | null;
  id: string;
}) {
  const readDb = args.ctx ? getReadDb(args.ctx) : db;
  const row = await readDb
    .select({
      asset: mediaAsset,
      applicationId: radarClaimApplicationEvidence.applicationId,
      orderId: radarOrder.id,
    })
    .from(mediaAsset)
    .leftJoin(
      radarClaimApplicationEvidence,
      eq(radarClaimApplicationEvidence.assetId, mediaAsset.id),
    )
    .leftJoin(radarOrder, eq(radarOrder.receiptAssetId, mediaAsset.id))
    .where(eq(mediaAsset.id, args.id))
    .get();
  if (!row) throw new NotFoundError("media_asset", args.id);

  if (
    row.asset.expiresAt &&
    row.asset.expiresAt.getTime() <= Date.now() &&
    row.applicationId == null &&
    row.orderId == null
  ) {
    throw new NotFoundError("media_asset", args.id);
  }

  if (row.asset.visibility !== "public") {
    if (!args.ctx) throw new UnauthorizedError("Sign in to view this media.");
    const userId = getActorUserId(args.ctx);
    if (row.asset.ownerUserId !== userId) {
      const access = await getRadarActorAccess({ ctx: args.ctx, db: readDb });
      if (!access.isAdmin) {
        throw new ForbiddenError("You cannot view this media.");
      }
    }
  }

  try {
    return {
      asset: publicAsset(row.asset),
      bytes: await readFile(resolveStoragePath(row.asset.storageKey)),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError("media_asset", args.id);
    }
    throw new InternalServiceError("Could not read media file.", error);
  }
}

export async function deleteMediaAsset(args: {
  ctx: ServiceContext;
  id: string;
}) {
  const userId = getActorUserId(args.ctx);
  const readDb = getReadDb(args.ctx);
  const row = await readDb
    .select({
      asset: mediaAsset,
      applicationId: radarClaimApplicationEvidence.applicationId,
      orderId: radarOrder.id,
    })
    .from(mediaAsset)
    .leftJoin(
      radarClaimApplicationEvidence,
      eq(radarClaimApplicationEvidence.assetId, mediaAsset.id),
    )
    .leftJoin(radarOrder, eq(radarOrder.receiptAssetId, mediaAsset.id))
    .where(eq(mediaAsset.id, args.id))
    .get();
  if (!row) throw new NotFoundError("media_asset", args.id);

  if (row.asset.ownerUserId !== userId) {
    const access = await getRadarActorAccess({ ctx: args.ctx, db: readDb });
    if (!access.isAdmin) {
      throw new ForbiddenError("You cannot delete this media.");
    }
  }
  if (row.applicationId != null) {
    throw new ConflictError(
      "Media attached to an application cannot be deleted.",
    );
  }
  if (row.orderId != null) {
    throw new ConflictError("Media attached to an order cannot be deleted.");
  }

  await withTransaction(args.ctx, async (tx) => {
    await tx.delete(mediaAsset).where(eq(mediaAsset.id, row.asset.id));
  });
  await removeStoredFile(row.asset.storageKey);

  return { id: row.asset.id };
}
