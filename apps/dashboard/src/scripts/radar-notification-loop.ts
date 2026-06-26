import {
  defaultIntervalMs,
  loadLocalEnv,
  parseBooleanEnv,
} from "./script-env";

loadLocalEnv();

const { dispatchPendingRadarNotifications } = await import(
  "@openstatus/services/radar"
);

const intervalMs = defaultIntervalMs("RADAR_NOTIFICATION_INTERVAL_MS", 60_000);
const runOnce = parseBooleanEnv("RADAR_NOTIFICATION_ONCE");
const maxEventAgeMs = defaultIntervalMs(
  "RADAR_NOTIFICATION_MAX_EVENT_AGE_MS",
  15 * 60 * 1000,
);
const replayGuardStartedAt = new Date();

let running = false;

console.log("[radar-notifications] starting", {
  intervalMs,
  maxEventAgeMs,
  replayGuardStartedAt: replayGuardStartedAt.toISOString(),
  policy:
    "only dispatch events created after worker start and within max event age",
});

async function tick() {
  if (running) {
    console.log("[radar-notifications] previous tick is still running, skipping");
    return;
  }

  running = true;
  const startedAt = Date.now();

  try {
    const result = await dispatchPendingRadarNotifications({
      maxEventAgeMs,
      replayGuardStartedAt,
    });
    console.log("[radar-notifications] completed", {
      ...result,
      dispatchCutoff: result.dispatchCutoff?.toISOString() ?? null,
      maxEventAgeMs,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("[radar-notifications] failed", error);
  } finally {
    running = false;
  }
}

await tick();

if (runOnce) {
  process.exit(0);
}

setInterval(() => {
  void tick();
}, intervalMs);
