import { createMediaAsset } from "@openstatus/services/media";

import { getServiceContextFromRequest } from "@/lib/edge-context";

import { hasValidMutationOrigin, serviceErrorResponse } from "./_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MULTIPART_REQUEST_BYTES = 6 * 1024 * 1024;

async function readRequestBodyWithLimit(request: Request, maxBytes: number) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function POST(request: Request) {
  if (!hasValidMutationOrigin(request)) {
    return Response.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_MULTIPART_REQUEST_BYTES
  ) {
    return Response.json(
      { error: "Uploaded file is too large" },
      { status: 413 },
    );
  }

  const ctx = await getServiceContextFromRequest(request);
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Uint8Array | null;
  try {
    body = await readRequestBodyWithLimit(request, MAX_MULTIPART_REQUEST_BYTES);
  } catch {
    return Response.json(
      { error: "Invalid multipart request" },
      { status: 400 },
    );
  }
  if (!body) {
    return Response.json(
      { error: "Uploaded file is too large" },
      { status: 413 },
    );
  }

  let formData: FormData;
  try {
    const headers = new Headers(request.headers);
    headers.set("content-length", String(body.byteLength));
    formData = await new Request(request.url, {
      method: request.method,
      headers,
      body: body.buffer as ArrayBuffer,
    }).formData();
  } catch {
    return Response.json(
      { error: "Invalid multipart request" },
      { status: 400 },
    );
  }

  const purpose = formData.get("purpose");
  const file = formData.get("file");
  if (
    !["claim_evidence", "order_receipt", "provider_logo"].includes(
      String(purpose),
    ) ||
    !(file instanceof File)
  ) {
    return Response.json({ error: "Invalid media upload" }, { status: 400 });
  }

  try {
    const asset = await createMediaAsset({
      ctx,
      input: {
        purpose: purpose as
          | "claim_evidence"
          | "order_receipt"
          | "provider_logo",
        originalFilename: file.name,
        declaredMimeType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      },
    });
    return Response.json(asset, { status: 201 });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
