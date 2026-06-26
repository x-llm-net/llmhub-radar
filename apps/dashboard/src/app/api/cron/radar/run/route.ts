import { runRadarCron } from "@openstatus/services/radar";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../_auth";

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
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runRadarCron();
  return NextResponse.json({ ok: true, ...result });
}
