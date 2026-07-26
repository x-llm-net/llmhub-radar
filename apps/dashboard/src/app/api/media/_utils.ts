import { ServiceError, type ServiceErrorCode } from "@openstatus/services";

const SERVICE_ERROR_STATUS: Record<ServiceErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  UNAUTHORIZED: 401,
  CONFLICT: 409,
  VALIDATION: 400,
  LIMIT_EXCEEDED: 429,
  PRECONDITION_FAILED: 412,
  INTERNAL: 500,
};

export function serviceErrorResponse(error: unknown) {
  if (error instanceof ServiceError) {
    return Response.json(
      {
        error:
          error.code === "INTERNAL" ? "Internal server error" : error.message,
      },
      { status: SERVICE_ERROR_STATUS[error.code] },
    );
  }
  console.error("[media] unexpected route error", error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

export function hasValidMutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0];
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0];
  const expectedOrigin = forwardedHost
    ? `${forwardedProto || requestUrl.protocol.replace(":", "")}://${forwardedHost}`
    : requestUrl.origin;

  try {
    return new URL(origin).origin === expectedOrigin;
  } catch {
    return false;
  }
}
