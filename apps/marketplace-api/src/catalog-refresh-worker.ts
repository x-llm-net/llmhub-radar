import {
  createMarketplaceDb,
  listHubCatalogRefreshGroups,
  refreshHubGroupCatalog,
  type MarketplaceDb,
} from "@llmhub/marketplace-db";
import {
  decryptSecret,
  discoverOpenAiCompatibleModels,
} from "@openstatus/services/radar/runtime";

import {
  DEFAULT_CATALOG_REFRESH_CONCURRENCY,
  runCatalogRefreshCycle,
  type CatalogRefreshCycleResult,
  type CatalogRefreshGroup,
} from "./catalog-refresh";

export const DEFAULT_CATALOG_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1_000;

type CatalogRefreshErrorCode =
  | "credential_decryption_failed"
  | "model_discovery_failed"
  | "catalog_persist_failed";

export interface HubCatalogRefreshGroup extends CatalogRefreshGroup {
  baseUrlCiphertext: string;
  apiKeyCiphertext: string;
}

export interface CatalogRefreshLogger {
  info(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

interface CatalogRefreshAdapterDependencies {
  decrypt: (ciphertext: string) => Promise<string>;
  discover: (credentials: {
    baseUrl: string;
    apiKey: string;
  }) => Promise<{ models: string[] }>;
  persist: (input: {
    groupId: string;
    discoveredModels: string[];
  }) => Promise<unknown>;
}

interface CatalogRefreshCycleDependencies extends CatalogRefreshAdapterDependencies {
  listGroups: () => Promise<readonly HubCatalogRefreshGroup[]>;
  logger?: CatalogRefreshLogger;
}

interface CatalogRefreshLoopOptions {
  concurrency?: number;
  intervalMs?: number;
  signal?: AbortSignal;
  logger?: CatalogRefreshLogger;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  runCycle?: () => Promise<CatalogRefreshCycleResult>;
}

export interface CatalogRefreshWorkerConfig {
  intervalMs: number;
  concurrency: number;
}

class CatalogRefreshGroupError extends Error {
  constructor(readonly code: CatalogRefreshErrorCode) {
    super(code);
    this.name = "CatalogRefreshGroupError";
  }
}

const consoleLogger: CatalogRefreshLogger = {
  info: (message, details) => console.log(message, details ?? {}),
  error: (message, details) => console.error(message, details ?? {}),
};

export async function refreshHubCatalogGroup(
  group: HubCatalogRefreshGroup,
  dependencies: CatalogRefreshAdapterDependencies,
) {
  let baseUrl: string;
  let apiKey: string;
  try {
    [baseUrl, apiKey] = await Promise.all([
      dependencies.decrypt(group.baseUrlCiphertext),
      dependencies.decrypt(group.apiKeyCiphertext),
    ]);
  } catch {
    throw new CatalogRefreshGroupError("credential_decryption_failed");
  }

  let discoveredModels: string[];
  try {
    const discovery = await dependencies.discover({ baseUrl, apiKey });
    discoveredModels = discovery.models;
  } catch {
    throw new CatalogRefreshGroupError("model_discovery_failed");
  }

  try {
    return await dependencies.persist({
      groupId: group.id,
      discoveredModels,
    });
  } catch {
    throw new CatalogRefreshGroupError("catalog_persist_failed");
  }
}

export function runHubCatalogRefreshCycle(
  dependencies: CatalogRefreshCycleDependencies,
  concurrency = DEFAULT_CATALOG_REFRESH_CONCURRENCY,
) {
  const logger = dependencies.logger ?? consoleLogger;
  return runCatalogRefreshCycle({
    listGroups: dependencies.listGroups,
    concurrency,
    refreshGroup: async (group) => {
      try {
        await refreshHubCatalogGroup(group, dependencies);
      } catch (error) {
        logger.error("Catalog refresh group failed", {
          groupId: group.id,
          error: catalogRefreshErrorCode(error),
        });
        throw error;
      }
    },
  });
}

export function createHubCatalogRefreshCycle(
  db: MarketplaceDb,
  options: {
    concurrency?: number;
    logger?: CatalogRefreshLogger;
  } = {},
) {
  return () =>
    runHubCatalogRefreshCycle(
      {
        listGroups: () => listHubCatalogRefreshGroups(db),
        decrypt: decryptSecret,
        discover: discoverOpenAiCompatibleModels,
        persist: (input) => refreshHubGroupCatalog(db, input),
        logger: options.logger,
      },
      options.concurrency,
    );
}

export async function runHubCatalogRefreshLoop(
  options: CatalogRefreshLoopOptions = {},
) {
  const intervalMs = options.intervalMs ?? DEFAULT_CATALOG_REFRESH_INTERVAL_MS;
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
    throw new Error("Catalog refresh interval must be a positive integer");
  }
  const logger = options.logger ?? consoleLogger;
  const sleep = options.sleep ?? abortableSleep;
  if (!options.runCycle) throw new Error("runCycle is required");

  while (!options.signal?.aborted) {
    try {
      const result = await options.runCycle();
      logger.info("Catalog refresh cycle completed", { ...result });
    } catch {
      logger.error("Catalog refresh cycle failed", {
        error: "catalog_refresh_cycle_failed",
      });
    }

    if (options.signal?.aborted) break;
    await sleep(intervalMs, options.signal);
  }
}

export function getCatalogRefreshWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CatalogRefreshWorkerConfig {
  return {
    intervalMs: positiveInteger(
      environment.MARKETPLACE_CATALOG_REFRESH_INTERVAL_MS,
      "MARKETPLACE_CATALOG_REFRESH_INTERVAL_MS",
      DEFAULT_CATALOG_REFRESH_INTERVAL_MS,
    ),
    concurrency: positiveInteger(
      environment.MARKETPLACE_CATALOG_REFRESH_CONCURRENCY,
      "MARKETPLACE_CATALOG_REFRESH_CONCURRENCY",
      DEFAULT_CATALOG_REFRESH_CONCURRENCY,
    ),
  };
}

export async function runHubCatalogRefreshWorker() {
  const databaseUrl = process.env.MARKETPLACE_DATABASE_URL;
  if (!databaseUrl) throw new Error("MARKETPLACE_DATABASE_URL is required");

  const config = getCatalogRefreshWorkerConfig();
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const { client, db } = createMarketplaceDb(databaseUrl);
  consoleLogger.info("LLMHub catalog refresh worker started", { ...config });
  try {
    await runHubCatalogRefreshLoop({
      ...config,
      signal: controller.signal,
      logger: consoleLogger,
      runCycle: createHubCatalogRefreshCycle(db, config),
    });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await client.close();
  }
}

function catalogRefreshErrorCode(error: unknown): CatalogRefreshErrorCode {
  return error instanceof CatalogRefreshGroupError
    ? error.code
    : "catalog_persist_failed";
}

function positiveInteger(
  input: string | undefined,
  name: string,
  fallback: number,
) {
  const value = Number(input ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function abortableSleep(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const timeout = setTimeout(done, milliseconds);
    signal?.addEventListener("abort", done, { once: true });

    function done() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", done);
      resolve();
    }
  });
}
