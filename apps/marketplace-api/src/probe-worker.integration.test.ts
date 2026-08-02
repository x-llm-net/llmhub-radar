import { beforeEach, describe, expect, test } from "bun:test";

import {
  createHubGroup,
  createMarketplaceDb,
  cleanupExpiredHistory,
  ensureHubProbeRunPartitions,
  hubConfigOutbox,
  hubGroupBlocks,
  hubGroupModels,
  hubGroupModelStats,
  hubGroupPriceVersions,
  hubGroupSecrets,
  hubHealthBuckets3h,
  hubModelAliases,
  hubModelPriceComponents,
  hubModelPriceVersions,
  hubModels,
  hubProbeCycles,
  hubProbeRuns,
  hubProbeTargets,
  hubProviderGroups,
  hubProviders,
  hubRelayChannelBindings,
} from "@llmhub/marketplace-db";
import { encryptSecret } from "@openstatus/services/radar/runtime";
import { eq, sql } from "drizzle-orm";

import { clearHubRoutingAndBillingTestData } from "../../../packages/marketplace-db/src/test-helpers";
import { runHubProbeBatch } from "./probe-worker";

const configuredUrl = process.env.MARKETPLACE_TEST_DATABASE_URL;
const databaseUrl =
  configuredUrl &&
  /(^|[_-])test([_-]|$)/i.test(
    new URL(configuredUrl).pathname.split("/").at(-1) ?? "",
  )
    ? configuredUrl
    : undefined;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("LLMHub v2 probe worker", () => {
  if (!databaseUrl) return;
  const { db } = createMarketplaceDb(databaseUrl);

  beforeEach(async () => {
    await clearHubRoutingAndBillingTestData(db);
    await db.delete(hubProbeRuns);
    await db.delete(hubProbeCycles);
    await db.delete(hubGroupModelStats);
    await db.delete(hubHealthBuckets3h);
    await db.delete(hubProbeTargets);
    await db.delete(hubGroupBlocks);
    await db.delete(hubGroupModels);
    await db.delete(hubGroupPriceVersions);
    await db.delete(hubGroupSecrets);
    await db.delete(hubRelayChannelBindings);
    await db.delete(hubConfigOutbox);
    await db.delete(hubProviderGroups);
    await db.delete(hubModelAliases);
    await db.delete(hubModelPriceComponents);
    await db.delete(hubModelPriceVersions);
    await db.delete(hubModels);
    await db.delete(hubProviders);
  });

  test("decrypts config, probes the upstream and stores current stats", async () => {
    const apiKey = "sk-worker-test-secret";
    const created = await createHubGroup(db, {
      ownerWorkspaceId: "workspace-worker-test",
      providerSlug: "worker-test-provider",
      providerName: "Worker Test Provider",
      name: "Pro",
      baseUrlCiphertext: await encryptSecret("https://api.example.com/v1"),
      baseUrlHostHash: "worker-test-host-hash",
      apiKeyCiphertext: await encryptSecret(apiKey),
      keyFingerprint: "worker-test-key-fingerprint",
      apiKeyLastFour: "cret",
      multiplierBps: 8_000,
      discoveredModels: ["gpt-worker-test"],
    });
    await db
      .update(hubProbeTargets)
      .set({ nextCheckAt: new Date(Date.now() - 1_000) });

    let requestUrl = "";
    let authorization = "";
    let requestBody: unknown;
    const result = await runHubProbeBatch(db, {
      workerId: "worker-integration-test",
      batchSize: 1,
      concurrency: 1,
      fetch: async (input, init) => {
        requestUrl = String(input);
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        requestBody = JSON.parse(String(init?.body));
        return new Response(
          [
            'data: {"choices":[{"delta":{"content":"o"}}]}',
            "",
            'data: {"choices":[{"delta":{"content":"k"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}',
            "",
            "data: [DONE]",
            "",
          ].join("\n"),
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        );
      },
    });

    expect(result.claimed).toBe(1);
    expect(requestUrl).toBe("https://api.example.com/v1/chat/completions");
    expect(authorization).toBe(`Bearer ${apiKey}`);
    expect(requestBody).toEqual(
      expect.objectContaining({ model: "gpt-worker-test", stream: true }),
    );

    const [run] = await db.select().from(hubProbeRuns);
    const [stats] = await db.select().from(hubGroupModelStats);
    const [group] = await db
      .select({ lifecycleStatus: hubProviderGroups.lifecycleStatus })
      .from(hubProviderGroups)
      .where(eq(hubProviderGroups.id, created.id));
    expect(run).toEqual(
      expect.objectContaining({ outcome: "success", httpStatus: 200 }),
    );
    expect(stats).toEqual(
      expect.objectContaining({
        sampleCount: 1,
        availabilityBps: 10_000,
        currentStatus: "normal",
      }),
    );
    expect(group?.lifecycleStatus).toBe("ready");

    const futureYear = 3_000 + (Date.now() % 5_000);
    const future = new Date(Date.UTC(futureYear, 4, 2));
    await db.update(hubProbeRuns).set({ scheduledAt: future });
    const [beforePartition] = await db.execute<{ tableName: string }>(sql`
      SELECT tableoid::regclass::text AS "tableName"
      FROM ${hubProbeRuns}
      LIMIT 1
    `);
    expect(beforePartition?.tableName).toBe("hub_probe_runs_default");
    await ensureHubProbeRunPartitions(db, future);
    const [afterPartition] = await db.execute<{ tableName: string }>(sql`
      SELECT tableoid::regclass::text AS "tableName"
      FROM ${hubProbeRuns}
      LIMIT 1
    `);
    expect(afterPartition?.tableName).toBe(`hub_probe_runs_${futureYear}_05`);

    const cleanup = await cleanupExpiredHistory(db, {
      now: new Date(Date.UTC(futureYear + 2, 0, 1)),
      batchSize: 10,
    });
    expect(cleanup.deletedHubProbeRuns).toBe(1);
    expect(cleanup.deletedHubProbeCycles).toBe(1);
    expect(cleanup.deletedHubBuckets).toBe(1);
    expect(await db.select().from(hubProbeRuns)).toHaveLength(0);
    expect(await db.select().from(hubProbeCycles)).toHaveLength(0);
    expect(await db.select().from(hubHealthBuckets3h)).toHaveLength(0);
  });
});
