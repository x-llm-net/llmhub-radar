import {
  deleteMediaAsset,
  getMediaAssetForRead,
} from "@openstatus/services/media";

import { getServiceContextFromRequest } from "@/lib/edge-context";

import { hasValidMutationOrigin, serviceErrorResponse } from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const ctx = await getServiceContextFromRequest(request);

  try {
    const result = await getMediaAssetForRead({ ctx, id });
    return new Response(Uint8Array.from(result.bytes), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Length": String(result.asset.sizeBytes),
        "Content-Type": result.asset.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!hasValidMutationOrigin(request)) {
    return Response.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const ctx = await getServiceContextFromRequest(request);
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  try {
    await deleteMediaAsset({ ctx, id });
    return new Response(null, { status: 204 });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
