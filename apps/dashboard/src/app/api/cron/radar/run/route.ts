import { runRadarCron } from "@openstatus/services/radar";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const revalidate = 0;

export async function GET(req: NextRequest) {
  return handleRadarCron(req);
}

export async function POST(req: NextRequest) {
  return handleRadarCron(req);
}

async function handleRadarCron(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runRadarCron();
  return NextResponse.json({ ok: true, ...result });
}

function isAuthorized(req: NextRequest) {
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
