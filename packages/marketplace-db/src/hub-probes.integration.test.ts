import { beforeEach, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { createMarketplaceDb } from "./db";
import { createHubGroup, setHubGroupState } from "./groups";
import {
  claimDueHubProbes,
  completeHubProbe,
  scheduleHubGroupProbeNow,
} from "./hub-probes";
import { getHubModelLeaderboard, getHubHomepageRankings } from "./hub-rankings";
import {
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
} from "./schema";
import { clearHubRoutingAndBillingTestData } from "./test-helpers";

const configuredUrl = process.env.MARKETPLACE_TEST_DATABASE_URL;
const databaseUrl =
  configuredUrl &&
  /(^|[_-])test([_-]|$)/i.test(
    new URL(configuredUrl).pathname.split("/").at(-1) ?? "",
  )
    ? configuredUrl
    : undefined;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("LLMHub v2 probe and ranking repository", () => {
  if (!databaseUrl) return;
  const { db } = createMarketplaceDb(databaseUrl);
  const baseTime = new Date("2026-08-02T08:00:00.000Z");

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

  test("claims a due target once across competing workers", async () => {
    await createGroup("workspace-a", "provider-a", "Pro");
    await db.update(hubProbeTargets).set({ nextCheckAt: baseTime });

    const [first, second] = await Promise.all([
      claimDueHubProbes(db, { workerId: "worker-a", now: baseTime }),
      claimDueHubProbes(db, { workerId: "worker-b", now: baseTime }),
    ]);

    expect(first.length + second.length).toBe(1);
    expect(
      new Set([...first, ...second].map((claim) => claim.targetId)).size,
    ).toBe(1);
  });

  test("reclaims an expired lease without duplicating its probe cycle", async () => {
    await createGroup("workspace-a", "provider-a", "Pro");
    await db.update(hubProbeTargets).set({ nextCheckAt: baseTime });

    const [abandoned] = await claimDueHubProbes(db, {
      workerId: "worker-a",
      now: baseTime,
      leaseMs: 1_000,
    });
    expect(abandoned).toBeDefined();
    const [reclaimed] = await claimDueHubProbes(db, {
      workerId: "worker-b",
      now: new Date(baseTime.getTime() + 2_000),
    });

    expect(reclaimed?.cycleId).toBe(abandoned?.cycleId);
    expect(reclaimed?.leaseToken).not.toBe(abandoned?.leaseToken);
    expect(await db.select().from(hubProbeCycles)).toHaveLength(1);
    if (!abandoned || !reclaimed) return;
    await expect(
      completeHubProbe(db, abandoned, {
        success: true,
        totalLatencyMs: 100,
      }),
    ).rejects.toThrow("Probe lease is no longer owned");
    await completeHubProbe(db, reclaimed, {
      success: true,
      totalLatencyMs: 100,
    });
    expect(await db.select().from(hubProbeRuns)).toHaveLength(1);
  });

  test("keeps the default lease longer than the configured timeout", async () => {
    await createGroup("workspace-a", "provider-a", "Pro");
    await db
      .update(hubProbeTargets)
      .set({ nextCheckAt: baseTime, timeoutMs: 120_000 });
    const [claim] = await claimDueHubProbes(db, {
      workerId: "worker-a",
      now: baseTime,
    });
    const [target] = await db.select().from(hubProbeTargets);

    expect(claim).toBeDefined();
    expect(target?.lockedUntil?.getTime()).toBe(baseTime.getTime() + 150_000);
  });

  test("records a probe, refreshes stats and marks current config ready", async () => {
    const groupId = await createGroup("workspace-a", "provider-a", "Pro");
    await db.update(hubProbeTargets).set({ nextCheckAt: baseTime });
    const [claim] = await claimDueHubProbes(db, {
      workerId: "worker-a",
      now: baseTime,
    });
    expect(claim).toBeDefined();
    if (!claim) return;

    await completeHubProbe(
      db,
      claim,
      {
        success: true,
        httpStatus: 200,
        firstTokenMs: 900,
        totalLatencyMs: 1_200,
        tokensIn: 1,
        tokensOut: 1,
      },
      {
        startedAt: baseTime,
        completedAt: new Date(baseTime.getTime() + 1_200),
      },
    );

    const [group] = await db
      .select({ lifecycleStatus: hubProviderGroups.lifecycleStatus })
      .from(hubProviderGroups)
      .where(eq(hubProviderGroups.id, groupId));
    const [stats] = await db.select().from(hubGroupModelStats);
    expect(group?.lifecycleStatus).toBe("ready");
    expect(stats).toEqual(
      expect.objectContaining({
        sampleCount: 1,
        availabilityBps: 10_000,
        firstTokenP50Ms: 900,
        eligible: false,
        eligibilityReason: "insufficient_samples",
      }),
    );
  });

  test("does not let an old config probe mark a changed group ready", async () => {
    const groupId = await createGroup("workspace-a", "provider-a", "Pro");
    await db.update(hubProbeTargets).set({ nextCheckAt: baseTime });
    const [claim] = await claimDueHubProbes(db, {
      workerId: "worker-a",
      now: baseTime,
    });
    if (!claim) return;
    await db
      .update(hubProviderGroups)
      .set({ configVersion: claim.configVersion + 1 })
      .where(eq(hubProviderGroups.id, groupId));

    await completeHubProbe(db, claim, {
      success: true,
      httpStatus: 200,
      firstTokenMs: 800,
      totalLatencyMs: 1_000,
    });

    const [group] = await db
      .select({ lifecycleStatus: hubProviderGroups.lifecycleStatus })
      .from(hubProviderGroups)
      .where(eq(hubProviderGroups.id, groupId));
    expect(group?.lifecycleStatus).toBe("verifying");
    expect(await db.select().from(hubGroupModelStats)).toHaveLength(0);
  });

  test("pause and active probe blocks prevent claims", async () => {
    const groupId = await createGroup("workspace-a", "provider-a", "Pro");
    await db.update(hubProbeTargets).set({ nextCheckAt: baseTime });
    await setHubGroupState(db, {
      ownerWorkspaceId: "workspace-a",
      groupId,
      action: "pause",
    });
    expect(
      await claimDueHubProbes(db, { workerId: "worker-a", now: baseTime }),
    ).toHaveLength(0);

    await setHubGroupState(db, {
      ownerWorkspaceId: "workspace-a",
      groupId,
      action: "resume",
    });
    await db.insert(hubGroupBlocks).values({
      groupId,
      source: "system",
      reasonCode: "test-block",
      stopsProbes: true,
    });
    expect(
      await claimDueHubProbes(db, { workerId: "worker-a", now: baseTime }),
    ).toHaveLength(0);
  });

  test("lists two groups from one provider independently for the same model", async () => {
    const firstGroupId = await createGroup("workspace-a", "provider-a", "Plus");
    const secondGroupId = await createGroup("workspace-a", "provider-a", "Pro");
    await db
      .update(hubProviderGroups)
      .set({ lifecycleStatus: "ready", listingStatus: "listed" });
    const groupModels = await db
      .select({ id: hubGroupModels.id })
      .from(hubGroupModels);
    for (let index = 0; index < groupModels.length; index += 1) {
      const groupModel = groupModels[index];
      if (!groupModel) continue;
      await db.insert(hubGroupModelStats).values({
        groupModelId: groupModel.id,
        windowStart: new Date(baseTime.getTime() - 7 * 24 * 60 * 60 * 1000),
        windowEnd: baseTime,
        availabilityBps: 9_900 - index * 100,
        coverageBps: 10_000,
        grade: "S",
        firstTokenP50Ms: 900 + index * 100,
        firstTokenP95Ms: 1_500 + index * 100,
        sampleCount: 10,
        validBucketCount: 4,
        rankingScoreBps: 9_500 - index * 100,
        currentStatus: "normal",
        eligible: true,
        lastCheckAt: baseTime,
      });
    }

    const board = await getHubModelLeaderboard(db, "gpt-5-5", {
      asOf: baseTime,
    });
    expect(board?.ranking.map((row) => row.group.id).sort()).toEqual(
      [firstGroupId, secondGroupId].sort(),
    );
    expect(board?.ranking.map((row) => row.group.name).sort()).toEqual([
      "Plus",
      "Pro",
    ]);
    expect(await getHubHomepageRankings(db, { asOf: baseTime })).toHaveLength(
      1,
    );
  });

  test("moves stale statistics out of the ranked list at read time", async () => {
    await createGroup("workspace-a", "provider-a", "Pro");
    await db
      .update(hubProviderGroups)
      .set({ lifecycleStatus: "ready", listingStatus: "listed" });
    const [groupModel] = await db.select().from(hubGroupModels);
    if (!groupModel) return;
    await db.insert(hubGroupModelStats).values({
      groupModelId: groupModel.id,
      windowStart: new Date(baseTime.getTime() - 7 * 24 * 60 * 60 * 1000),
      windowEnd: baseTime,
      availabilityBps: 10_000,
      coverageBps: 10_000,
      grade: "S",
      firstTokenP50Ms: 700,
      firstTokenP95Ms: 1_200,
      sampleCount: 20,
      validBucketCount: 4,
      rankingScoreBps: 9_900,
      currentStatus: "normal",
      eligible: true,
      lastCheckAt: baseTime,
    });

    const board = await getHubModelLeaderboard(db, "gpt-5-5", {
      asOf: new Date(baseTime.getTime() + 31 * 60 * 1000),
    });
    expect(board?.ranking).toHaveLength(0);
    expect(board?.observing[0]).toEqual(
      expect.objectContaining({
        currentStatus: "stale",
        eligibilityReason: "stale",
      }),
    );
  });

  test("pauses quota failures, preserves ranking history and auto-recovers", async () => {
    await createGroup("workspace-a", "provider-a", "Pro");
    await db
      .update(hubProviderGroups)
      .set({ lifecycleStatus: "ready", listingStatus: "listed" });
    await db.update(hubProbeTargets).set({ nextCheckAt: baseTime });
    const [first] = await claimDueHubProbes(db, {
      workerId: "worker-a",
      now: baseTime,
    });
    if (!first) return;
    for (let index = 0; index < 4; index += 1) {
      const claim =
        index === 0
          ? first
          : (
              await claimDueHubProbes(db, {
                workerId: "worker-a",
                now: new Date(baseTime.getTime() + index * 600_000),
              })
            )[0];
      if (!claim) return;
      await completeHubProbe(
        db,
        claim,
        {
          success: true,
          firstTokenMs: 800,
          totalLatencyMs: 1_000,
        },
        { completedAt: new Date(baseTime.getTime() + index * 600_000) },
      );
    }
    const [before] = await db.select().from(hubGroupModelStats);
    expect(before?.sampleCount).toBe(4);
    await db
      .update(hubProbeTargets)
      .set({ nextCheckAt: new Date(baseTime.getTime() + 4 * 600_000) });
    const [quotaClaim] = await claimDueHubProbes(db, {
      workerId: "worker-a",
      now: new Date(baseTime.getTime() + 4 * 600_000),
    });
    if (!quotaClaim) return;
    const quotaAt = new Date(baseTime.getTime() + 4 * 600_000);
    await completeHubProbe(
      db,
      quotaClaim,
      {
        success: false,
        errorType: "insufficient_quota",
        safeErrorSummary: "balance exhausted",
        totalLatencyMs: 200,
      },
      { completedAt: quotaAt },
    );

    const [block] = await db.select().from(hubGroupBlocks);
    const [target] = await db.select().from(hubProbeTargets);
    const [pausedStats] = await db.select().from(hubGroupModelStats);
    const pausedBoard = await getHubModelLeaderboard(db, "gpt-5-5", {
      asOf: new Date(quotaAt.getTime() + 3 * 24 * 60 * 60 * 1000),
    });
    expect(block).toEqual(
      expect.objectContaining({
        source: "balance",
        reasonCode: "insufficient_quota",
        stopsTraffic: true,
        stopsProbes: false,
        resolvedAt: null,
      }),
    );
    expect(target?.nextCheckAt.getTime()).toBe(
      quotaAt.getTime() + 6 * 60 * 60 * 1000,
    );
    expect(pausedStats?.sampleCount).toBe(before?.sampleCount);
    expect(pausedBoard?.ranking[0]?.naturalRank).toBe(1);

    const recoveryAt = target?.nextCheckAt;
    if (!recoveryAt) return;
    const [recoveryClaim] = await claimDueHubProbes(db, {
      workerId: "worker-a",
      now: recoveryAt,
    });
    if (!recoveryClaim) return;
    await completeHubProbe(
      db,
      recoveryClaim,
      { success: true, firstTokenMs: 700, totalLatencyMs: 900 },
      { completedAt: recoveryAt },
    );
    expect(
      (await db.select().from(hubGroupBlocks))[0]?.resolvedAt,
    ).not.toBeNull();
  });

  test("applies quota pause penalties to ranking and removes them after recovery", async () => {
    const pausedGroupId = await createGroup("workspace-a", "provider-a", "Pro");
    const activeGroupId = await createGroup(
      "workspace-b",
      "provider-b",
      "Plus",
    );
    await db
      .update(hubProviderGroups)
      .set({ lifecycleStatus: "ready", listingStatus: "listed" });
    const asOf = new Date(baseTime.getTime() + 3 * 24 * 60 * 60 * 1000);
    const groupModels = await db
      .select({ id: hubGroupModels.id, groupId: hubGroupModels.groupId })
      .from(hubGroupModels);
    for (const groupModel of groupModels) {
      await db.insert(hubGroupModelStats).values({
        groupModelId: groupModel.id,
        windowStart: new Date(asOf.getTime() - 7 * 24 * 60 * 60 * 1000),
        windowEnd: asOf,
        availabilityBps: 9_900,
        coverageBps: 10_000,
        grade: "A",
        firstTokenP50Ms: 800,
        firstTokenP95Ms: 1_200,
        sampleCount: 20,
        validBucketCount: 4,
        rankingScoreBps: groupModel.groupId === pausedGroupId ? 9_000 : 8_800,
        currentStatus: "normal",
        eligible: true,
        lastCheckAt: asOf,
      });
    }
    await db.insert(hubGroupBlocks).values({
      groupId: pausedGroupId,
      source: "balance",
      reasonCode: "insufficient_quota",
      stopsTraffic: true,
      stopsProbes: false,
      autoClear: true,
      createdAt: baseTime,
    });

    const pausedBoard = await getHubModelLeaderboard(db, "gpt-5-5", {
      asOf,
    });
    expect(pausedBoard?.ranking.map((row) => row.group.id)).toEqual([
      activeGroupId,
      pausedGroupId,
    ]);

    await db
      .update(hubGroupBlocks)
      .set({ resolvedAt: asOf })
      .where(eq(hubGroupBlocks.groupId, pausedGroupId));
    const recoveredBoard = await getHubModelLeaderboard(db, "gpt-5-5", {
      asOf,
    });
    expect(recoveredBoard?.ranking.map((row) => row.group.id)).toEqual([
      pausedGroupId,
      activeGroupId,
    ]);
  });

  test("does not let another model clear a group quota pause", async () => {
    await createHubGroup(db, {
      ownerWorkspaceId: "workspace-a",
      providerSlug: "provider-a",
      providerName: "Provider A",
      name: "Pro",
      baseUrlCiphertext: "encrypted-base-url",
      baseUrlHostHash: "host-hash",
      apiKeyCiphertext: "encrypted-api-key",
      keyFingerprint: "key-fingerprint",
      apiKeyLastFour: "test",
      multiplierBps: 8_000,
      discoveredModels: ["gpt-5.5", "gpt-5.6"],
    });
    await db.update(hubProbeTargets).set({ nextCheckAt: baseTime });
    const claims = await claimDueHubProbes(db, {
      workerId: "worker-a",
      now: baseTime,
      limit: 2,
    });
    expect(claims).toHaveLength(2);
    const quotaClaim = claims[0];
    const otherClaim = claims[1];
    if (!quotaClaim || !otherClaim) return;
    await completeHubProbe(
      db,
      quotaClaim,
      {
        success: false,
        errorType: "insufficient_quota",
        totalLatencyMs: 100,
      },
      { completedAt: baseTime },
    );
    await completeHubProbe(
      db,
      otherClaim,
      { success: true, totalLatencyMs: 100 },
      { completedAt: new Date(baseTime.getTime() + 100) },
    );
    expect((await db.select().from(hubGroupBlocks))[0]?.resolvedAt).toBeNull();
  });

  test("immediate probe scheduling is scoped to the owning workspace", async () => {
    const groupId = await createGroup("workspace-a", "provider-a", "Pro");
    const scheduled = await scheduleHubGroupProbeNow(
      db,
      "workspace-a",
      groupId,
    );
    const denied = await scheduleHubGroupProbeNow(db, "workspace-b", groupId);
    expect(scheduled.scheduled).toBe(1);
    expect(denied.scheduled).toBe(0);
  });

  async function createGroup(
    workspaceId: string,
    providerSlug: string,
    groupName: string,
  ) {
    const created = await createHubGroup(db, {
      ownerWorkspaceId: workspaceId,
      providerSlug,
      providerName: "Provider A",
      name: groupName,
      baseUrlCiphertext: "encrypted-base-url",
      baseUrlHostHash: "host-hash",
      apiKeyCiphertext: "encrypted-api-key",
      keyFingerprint: "key-fingerprint",
      apiKeyLastFour: "test",
      multiplierBps: groupName === "Pro" ? 8_000 : 6_000,
      discoveredModels: ["gpt-5.5"],
    });
    const [model] = await db
      .select({ id: hubModels.id })
      .from(hubModels)
      .where(eq(hubModels.canonicalName, "gpt-5.5"));
    expect(model).toBeDefined();
    return created.id;
  }
});
