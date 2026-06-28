import {
  defaultIntervalMs,
  loadLocalEnv,
  parseBooleanEnv,
} from "./script-env";

loadLocalEnv();

const { getPriorityProbeRuntimeConfig, runRadarCron } = await import(
  "@openstatus/services/radar"
);

const intervalMs = defaultIntervalMs("RADAR_CRON_INTERVAL_MS", 60_000);
const runOnce = parseBooleanEnv("RADAR_CRON_ONCE");
const priorityProbeConfig = getPriorityProbeRuntimeConfig();

console.log("[radar-cron] starting", {
  intervalMs,
  runOnce,
  priorityPoolSlugs: Array.from(priorityProbeConfig.poolSlugs),
  priorityProbeRetries: priorityProbeConfig.retryAttempts,
  priorityProbeRetryBackoffMs: priorityProbeConfig.retryBackoffMs,
});

let running = false;

async function tick() {
  if (running) {
    console.log("[radar-cron] previous tick is still running, skipping");
    return;
  }

  running = true;
  const startedAt = Date.now();

  try {
    const result = await runRadarCron();
    console.log("[radar-cron] completed", {
      ...result,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("[radar-cron] failed", error);
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
