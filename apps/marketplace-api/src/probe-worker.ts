import { hostname } from "node:os";

import {
  claimDueHubProbes,
  completeHubProbe,
  createMarketplaceDb,
  ensureHubProbeRunPartitions,
  failHubProbeLease,
  type ClaimedHubProbe,
  type MarketplaceDb,
} from "@llmhub/marketplace-db";
import {
  decryptSecret,
  runOpenAICompatibleProbe,
} from "@openstatus/services/radar/runtime";

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_CONCURRENCY = 10;
type ProbeFetch = (
  input: URL | RequestInfo,
  init?: RequestInit,
) => Promise<Response>;

export async function runHubProbeBatch(
  db: MarketplaceDb,
  options: {
    workerId?: string;
    batchSize?: number;
    concurrency?: number;
    fetch?: ProbeFetch;
  } = {},
) {
  const workerId = options.workerId ?? `${hostname()}:${process.pid}`;
  const claims = await claimDueHubProbes(db, {
    workerId,
    limit: options.batchSize ?? DEFAULT_BATCH_SIZE,
  });
  await runWithConcurrency(
    claims,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    (claim) => executeProbe(db, claim, options.fetch),
  );
  return { claimed: claims.length };
}

async function executeProbe(
  db: MarketplaceDb,
  claim: ClaimedHubProbe,
  fetchImplementation?: ProbeFetch,
) {
  const startedAt = new Date();
  try {
    const [baseUrl, apiKey] = await Promise.all([
      decryptSecret(claim.baseUrlOverrideCiphertext ?? claim.baseUrlCiphertext),
      decryptSecret(claim.apiKeyCiphertext),
    ]);
    const result = await runOpenAICompatibleProbe({
      baseUrl,
      apiKey,
      model: claim.upstreamModelName,
      timeoutMs: claim.timeoutMs,
      stream: true,
      fetch: fetchImplementation,
    });
    await completeHubProbe(db, claim, result, { startedAt });
  } catch (error) {
    try {
      await failHubProbeLease(db, claim, error);
    } catch (leaseError) {
      if (!isLostLeaseError(leaseError)) throw leaseError;
    }
  }
}

async function runWithConcurrency<T>(
  values: T[],
  concurrency: number,
  execute: (value: T) => Promise<void>,
) {
  const queue = [...values];
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), queue.length) },
    async () => {
      while (queue.length > 0) {
        const value = queue.shift();
        if (value !== undefined) await execute(value);
      }
    },
  );
  await Promise.all(workers);
}

function positiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export async function runHubProbeWorker() {
  const databaseUrl = process.env.MARKETPLACE_DATABASE_URL;
  if (!databaseUrl) throw new Error("MARKETPLACE_DATABASE_URL is required");
  const pollIntervalMs = positiveInteger(
    "MARKETPLACE_PROBE_POLL_INTERVAL_MS",
    DEFAULT_POLL_INTERVAL_MS,
  );
  const batchSize = positiveInteger(
    "MARKETPLACE_PROBE_BATCH_SIZE",
    DEFAULT_BATCH_SIZE,
  );
  const concurrency = positiveInteger(
    "MARKETPLACE_PROBE_CONCURRENCY",
    DEFAULT_CONCURRENCY,
  );
  const { client, db } = createMarketplaceDb(databaseUrl);
  await ensureHubProbeRunPartitions(db);
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  console.log("LLMHub v2 probe worker started", {
    pollIntervalMs,
    batchSize,
    concurrency,
  });
  try {
    while (!stopping) {
      try {
        const result = await runHubProbeBatch(db, { batchSize, concurrency });
        if (result.claimed > 0) console.log("Probe batch completed", result);
      } catch (error) {
        console.error("Probe batch failed", error);
      }
      if (!stopping) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }
  } finally {
    await client.close();
  }
}

function isLostLeaseError(error: unknown) {
  return (
    error instanceof Error &&
    error.message === "Probe lease is no longer owned by this worker"
  );
}
