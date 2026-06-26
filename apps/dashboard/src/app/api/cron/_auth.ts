import type { NextRequest } from "next/server";

export function isAuthorizedCronRequest(req: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return isLocalhost(req.url);
  }

  const authorization = req.headers.get("authorization");
  return authorization === `Bearer ${secret}` || authorization === secret;
}

function isLocalhost(url: string) {
  try {
    const hostname = new URL(url).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}
