import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CATALOG_REFRESH_INTERVAL_MS,
  getCatalogRefreshWorkerConfig,
  refreshHubCatalogGroup,
  runHubCatalogRefreshCycle,
  runHubCatalogRefreshLoop,
  type CatalogRefreshLogger,
  type HubCatalogRefreshGroup,
} from "./catalog-refresh-worker";

function group(id: string): HubCatalogRefreshGroup {
  return {
    id,
    lifecycleStatus: "ready",
    desiredStatus: "active",
    baseUrlCiphertext: `encrypted-url-${id}`,
    apiKeyCiphertext: `encrypted-key-${id}`,
  };
}

function memoryLogger() {
  const entries: Array<{
    level: "info" | "error";
    message: string;
    details?: Record<string, unknown>;
  }> = [];
  const logger: CatalogRefreshLogger = {
    info: (message, details) =>
      entries.push({ level: "info", message, details }),
    error: (message, details) =>
      entries.push({ level: "error", message, details }),
  };
  return { entries, logger };
}

describe("catalog refresh worker", () => {
  test("decrypts credentials, discovers models and persists the catalog", async () => {
    const decrypted: string[] = [];
    const persisted: Array<{ groupId: string; discoveredModels: string[] }> =
      [];

    await refreshHubCatalogGroup(group("group-a"), {
      decrypt: async (ciphertext) => {
        decrypted.push(ciphertext);
        return ciphertext.includes("url")
          ? "https://provider.example/v1"
          : "secret-api-key";
      },
      discover: async (credentials) => {
        expect(credentials).toEqual({
          baseUrl: "https://provider.example/v1",
          apiKey: "secret-api-key",
        });
        return { models: ["gpt-5", "claude-sonnet-4"] };
      },
      persist: async (input) => {
        persisted.push(input);
      },
    });

    expect(decrypted).toEqual([
      "encrypted-url-group-a",
      "encrypted-key-group-a",
    ]);
    expect(persisted).toEqual([
      {
        groupId: "group-a",
        discoveredModels: ["gpt-5", "claude-sonnet-4"],
      },
    ]);
  });

  test("isolates one group failure and emits only a safe error code", async () => {
    const { entries, logger } = memoryLogger();
    const persisted: string[] = [];
    const secret = "do-not-log-this-key";
    const fullUrl = "https://private.example/internal/v1";

    const result = await runHubCatalogRefreshCycle(
      {
        listGroups: async () => [group("fails"), group("works")],
        decrypt: async (ciphertext) => {
          if (ciphertext === "encrypted-url-fails") return fullUrl;
          if (ciphertext === "encrypted-key-fails") return secret;
          return ciphertext.includes("url")
            ? "https://working.example/v1"
            : "working-key";
        },
        discover: async ({ apiKey }) => {
          if (apiKey === secret) {
            throw new Error(`failed ${fullUrl} with ${secret}`);
          }
          return { models: ["gpt-5"] };
        },
        persist: async ({ groupId }) => {
          persisted.push(groupId);
        },
        logger,
      },
      2,
    );

    expect(result).toEqual({ attempted: 2, succeeded: 1, failed: 1 });
    expect(persisted).toEqual(["works"]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.details).toEqual({
      groupId: "fails",
      error: "model_discovery_failed",
    });
    expect(JSON.stringify(entries)).not.toContain(secret);
    expect(JSON.stringify(entries)).not.toContain(fullUrl);
  });

  test("runs immediately, waits six hours by default and stops on abort", async () => {
    const controller = new AbortController();
    const waits: number[] = [];
    let cycles = 0;

    await runHubCatalogRefreshLoop({
      signal: controller.signal,
      logger: memoryLogger().logger,
      runCycle: async () => {
        cycles += 1;
        return { attempted: 1, succeeded: 1, failed: 0 };
      },
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
        controller.abort();
      },
    });

    expect(cycles).toBe(1);
    expect(waits).toEqual([DEFAULT_CATALOG_REFRESH_INTERVAL_MS]);
  });

  test("uses worker defaults and validates environment overrides", () => {
    expect(getCatalogRefreshWorkerConfig({})).toEqual({
      intervalMs: 21_600_000,
      concurrency: 10,
    });
    expect(
      getCatalogRefreshWorkerConfig({
        MARKETPLACE_CATALOG_REFRESH_INTERVAL_MS: "120000",
        MARKETPLACE_CATALOG_REFRESH_CONCURRENCY: "4",
      }),
    ).toEqual({ intervalMs: 120_000, concurrency: 4 });
    expect(() =>
      getCatalogRefreshWorkerConfig({
        MARKETPLACE_CATALOG_REFRESH_CONCURRENCY: "0",
      }),
    ).toThrow(
      "MARKETPLACE_CATALOG_REFRESH_CONCURRENCY must be a positive integer",
    );
  });
});
