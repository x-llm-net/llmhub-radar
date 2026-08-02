import { describe, expect, test } from "bun:test";

import { runCatalogRefreshCycle } from "./catalog-refresh";

interface TestGroup {
  id: string;
  lifecycleStatus: "draft" | "verifying" | "ready" | "retired";
  desiredStatus: "active" | "paused" | "retired";
}

function group(
  id: string,
  lifecycleStatus: TestGroup["lifecycleStatus"] = "ready",
  desiredStatus: TestGroup["desiredStatus"] = "active",
): TestGroup {
  return { id, lifecycleStatus, desiredStatus };
}

describe("runCatalogRefreshCycle", () => {
  test("attempts every non-retired group and isolates refresh failures", async () => {
    const refreshed: string[] = [];
    const result = await runCatalogRefreshCycle({
      listGroups: async () => [
        group("ready"),
        group("paused", "ready", "paused"),
        group("fails", "verifying"),
        group("lifecycle-retired", "retired"),
        group("desired-retired", "ready", "retired"),
        group("draft", "draft"),
      ],
      refreshGroup: async (candidate) => {
        refreshed.push(candidate.id);
        if (candidate.id === "fails") throw new Error("upstream failed");
      },
    });

    expect(refreshed.sort()).toEqual(["draft", "fails", "paused", "ready"]);
    expect(result).toEqual({ attempted: 4, succeeded: 3, failed: 1 });
  });

  test("uses a default concurrency of ten", async () => {
    let active = 0;
    let peakConcurrency = 0;
    const groups = Array.from({ length: 23 }, (_, index) =>
      group(`group-${index}`),
    );

    const result = await runCatalogRefreshCycle({
      listGroups: async () => groups,
      refreshGroup: async () => {
        active += 1;
        peakConcurrency = Math.max(peakConcurrency, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      },
    });

    expect(peakConcurrency).toBe(10);
    expect(result).toEqual({ attempted: 23, succeeded: 23, failed: 0 });
  });

  test("honors a custom concurrency and rejects invalid values", async () => {
    let active = 0;
    let peakConcurrency = 0;

    const result = await runCatalogRefreshCycle({
      listGroups: async () =>
        Array.from({ length: 7 }, (_, index) => group(`group-${index}`)),
      refreshGroup: async () => {
        active += 1;
        peakConcurrency = Math.max(peakConcurrency, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      },
      concurrency: 3,
    });

    expect(peakConcurrency).toBe(3);
    expect(result).toEqual({ attempted: 7, succeeded: 7, failed: 0 });

    await expect(
      runCatalogRefreshCycle({
        listGroups: async () => [],
        refreshGroup: async () => undefined,
        concurrency: 0,
      }),
    ).rejects.toThrow("Catalog refresh concurrency must be a positive integer");
  });
});
