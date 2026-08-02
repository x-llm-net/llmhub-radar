import {
  runCleanupFromEnv,
  runHubBillingMaintenanceFromEnv,
  runLegacySyncFromEnv,
} from "./maintenance-tasks";

const DEFAULT_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function positiveInterval(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1_000) {
    throw new Error(`${name} must be a number greater than or equal to 1000`);
  }
  return parsed;
}

let stopping = false;
let wake: (() => void) | undefined;

function stop() {
  stopping = true;
  wake?.();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function sleep(ms: number) {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
  wake = undefined;
}

async function runMaintenanceLoop() {
  const syncIntervalMs = positiveInterval(
    "MARKETPLACE_SYNC_INTERVAL_MS",
    DEFAULT_SYNC_INTERVAL_MS,
  );
  const cleanupIntervalMs = positiveInterval(
    "MARKETPLACE_CLEANUP_INTERVAL_MS",
    DEFAULT_CLEANUP_INTERVAL_MS,
  );
  let nextCleanupAt = 0;

  console.log(
    `Marketplace maintenance started: sync=${syncIntervalMs}ms cleanup=${cleanupIntervalMs}ms`,
  );

  while (!stopping) {
    const startedAt = Date.now();
    try {
      const result = await runLegacySyncFromEnv();
      console.log("Marketplace sync completed", result);
    } catch (error) {
      console.error("Marketplace sync failed", error);
    }

    try {
      const result = await runHubBillingMaintenanceFromEnv();
      if (result.captured > 0 || result.failed > 0 || result.released > 0) {
        console.log("Marketplace billing maintenance completed", result);
      }
    } catch (error) {
      console.error("Marketplace billing maintenance failed", error);
    }

    if (Date.now() >= nextCleanupAt) {
      try {
        const result = await runCleanupFromEnv();
        console.log("Marketplace cleanup completed", result);
      } catch (error) {
        console.error("Marketplace cleanup failed", error);
      }
      nextCleanupAt = Date.now() + cleanupIntervalMs;
    }

    if (!stopping) {
      await sleep(Math.max(1_000, syncIntervalMs - (Date.now() - startedAt)));
    }
  }

  console.log("Marketplace maintenance stopped");
}

void runMaintenanceLoop();
