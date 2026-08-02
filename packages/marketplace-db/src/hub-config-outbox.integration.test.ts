import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";

import { eq, inArray, sql } from "drizzle-orm";

import { createMarketplaceDb } from "./db";
import {
  claimDueHubConfigTasks,
  deactivateHubRelayChannelBindings,
  HubConfigLeaseError,
  isHubConfigTaskStale,
  listHubRelayChannelBindings,
  markHubConfigTaskApplied,
  markHubConfigTaskFailed,
  upsertHubRelayChannelBinding,
} from "./hub-config-outbox";
import {
  hubConfigOutbox,
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

describeDatabase("LLMHub Stage C config outbox repository", () => {
  if (!databaseUrl) return;
  const { client, db } = createMarketplaceDb(databaseUrl);
  const baseTime = new Date("2026-08-02T08:00:00.000Z");
  const createdGroupIds: string[] = [];
  const createdProviderIds: string[] = [];

  beforeAll(async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS hub_config_outbox (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id uuid NOT NULL REFERENCES hub_provider_groups(id) ON DELETE RESTRICT,
        config_version integer NOT NULL,
        action text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        locked_until timestamptz,
        last_error text,
        applied_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT hub_config_outbox_action_check
          CHECK (action IN ('upsert', 'disable')),
        CONSTRAINT hub_config_outbox_status_check
          CHECK (status IN ('pending', 'processing', 'applied', 'failed')),
        CONSTRAINT hub_config_outbox_counts_check
          CHECK (config_version > 0 AND attempts >= 0)
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS hub_config_outbox_group_version_uidx
      ON hub_config_outbox (group_id, config_version, action)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS hub_config_outbox_due_idx
      ON hub_config_outbox (status, next_attempt_at, locked_until)
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS hub_relay_channel_bindings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id uuid NOT NULL REFERENCES hub_provider_groups(id) ON DELETE RESTRICT,
        route_key text NOT NULL,
        external_channel_id text NOT NULL,
        applied_config_version integer NOT NULL,
        config_checksum text NOT NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT hub_relay_channel_bindings_version_check
          CHECK (applied_config_version > 0)
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS hub_relay_channel_bindings_route_uidx
      ON hub_relay_channel_bindings (group_id, route_key)
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS hub_relay_channel_bindings_external_uidx
      ON hub_relay_channel_bindings (external_channel_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS hub_relay_channel_bindings_group_idx
      ON hub_relay_channel_bindings (group_id)
    `);
  });

  afterEach(async () => {
    await clearHubRoutingAndBillingTestData(db);
    if (createdGroupIds.length > 0) {
      await db
        .delete(hubRelayChannelBindings)
        .where(inArray(hubRelayChannelBindings.groupId, createdGroupIds));
      await db
        .delete(hubConfigOutbox)
        .where(inArray(hubConfigOutbox.groupId, createdGroupIds));
      await db
        .delete(hubProviderGroups)
        .where(inArray(hubProviderGroups.id, createdGroupIds));
      createdGroupIds.length = 0;
    }
    if (createdProviderIds.length > 0) {
      await db
        .delete(hubProviders)
        .where(inArray(hubProviders.id, createdProviderIds));
      createdProviderIds.length = 0;
    }
  });

  afterAll(async () => {
    await client.close();
  });

  test("claims each due task once across competing workers", async () => {
    const groupId = await createGroup();
    await enqueue(groupId, 1, "upsert");

    const [first, second] = await Promise.all([
      claimDueHubConfigTasks(db, { now: baseTime }),
      claimDueHubConfigTasks(db, { now: baseTime }),
    ]);

    expect(first.length + second.length).toBe(1);
    const claim = [...first, ...second][0];
    expect(claim).toEqual(
      expect.objectContaining({
        groupId,
        configVersion: 1,
        action: "upsert",
        attempts: 1,
        stale: false,
      }),
    );
  });

  test("reclaims an expired lease and fences the abandoned worker", async () => {
    const groupId = await createGroup();
    await enqueue(groupId, 1, "upsert");
    const [abandoned] = await claimDueHubConfigTasks(db, {
      now: baseTime,
      leaseMs: 1_000,
    });
    const reclaimAt = new Date(baseTime.getTime() + 2_000);
    const [reclaimed] = await claimDueHubConfigTasks(db, {
      now: reclaimAt,
      leaseMs: 10_000,
    });
    expect(abandoned).toBeDefined();
    expect(reclaimed?.id).toBe(abandoned?.id);
    expect(reclaimed?.attempts).toBe(2);
    if (!abandoned || !reclaimed) return;

    await expect(
      markHubConfigTaskApplied(db, abandoned, { now: reclaimAt }),
    ).rejects.toBeInstanceOf(HubConfigLeaseError);
    await markHubConfigTaskApplied(db, reclaimed, {
      now: new Date(reclaimAt.getTime() + 1_000),
    });
    await markHubConfigTaskApplied(db, reclaimed, {
      now: new Date(reclaimAt.getTime() + 2_000),
    });
    const [row] = await db.select().from(hubConfigOutbox);
    expect(row).toEqual(
      expect.objectContaining({ status: "applied", attempts: 2 }),
    );
  });

  test("retries failures with bounded exponential backoff", async () => {
    const groupId = await createGroup();
    await enqueue(groupId, 1, "upsert");
    const [first] = await claimDueHubConfigTasks(db, { now: baseTime });
    if (!first) return;
    const firstFailureAt = new Date(baseTime.getTime() + 100);
    const firstFailure = await markHubConfigTaskFailed(
      db,
      first,
      new Error("relay unavailable"),
      { now: firstFailureAt, baseDelayMs: 1_000, maxDelayMs: 2_000 },
    );
    expect(firstFailure.delayMs).toBe(1_000);
    expect(
      await claimDueHubConfigTasks(db, {
        now: new Date(firstFailure.nextAttemptAt.getTime() - 1),
      }),
    ).toHaveLength(0);

    const [second] = await claimDueHubConfigTasks(db, {
      now: firstFailure.nextAttemptAt,
    });
    if (!second) return;
    const secondFailure = await markHubConfigTaskFailed(db, second, "again", {
      now: new Date(firstFailure.nextAttemptAt.getTime() + 100),
      baseDelayMs: 1_000,
      maxDelayMs: 2_000,
    });
    expect(secondFailure.delayMs).toBe(2_000);
    const [row] = await db.select().from(hubConfigOutbox);
    expect(row).toEqual(
      expect.objectContaining({
        status: "failed",
        attempts: 2,
        lastError: "again",
      }),
    );
  });

  test("identifies an old config version as stale", async () => {
    const groupId = await createGroup();
    await enqueue(groupId, 1, "upsert");
    await db
      .update(hubProviderGroups)
      .set({ configVersion: 2 })
      .where(eq(hubProviderGroups.id, groupId));

    const [claim] = await claimDueHubConfigTasks(db, { now: baseTime });
    expect(claim?.stale).toBe(true);
    if (!claim) return;
    expect(await isHubConfigTaskStale(db, claim)).toBe(true);
    await markHubConfigTaskApplied(db, claim, {
      now: new Date(baseTime.getTime() + 100),
    });
  });

  test("upserts bindings idempotently and rejects stale writes", async () => {
    const groupId = await createGroup();
    const first = await upsertHubRelayChannelBinding(db, {
      groupId,
      routeKey: "default",
      externalChannelId: "channel-1",
      configVersion: 1,
      configChecksum: "checksum-1",
      now: baseTime,
    });
    const repeated = await upsertHubRelayChannelBinding(db, {
      groupId,
      routeKey: "default",
      externalChannelId: "channel-1",
      configVersion: 1,
      configChecksum: "checksum-1",
      now: new Date(baseTime.getTime() + 1_000),
    });
    expect(first.status).toBe("applied");
    expect(repeated.status).toBe("unchanged");
    expect(await listHubRelayChannelBindings(db, groupId)).toHaveLength(1);

    await db
      .update(hubProviderGroups)
      .set({ configVersion: 2 })
      .where(eq(hubProviderGroups.id, groupId));
    const current = await upsertHubRelayChannelBinding(db, {
      groupId,
      routeKey: "default",
      externalChannelId: "channel-1",
      configVersion: 2,
      configChecksum: "checksum-2",
    });
    const stale = await upsertHubRelayChannelBinding(db, {
      groupId,
      routeKey: "default",
      externalChannelId: "old-channel",
      configVersion: 1,
      configChecksum: "old-checksum",
    });
    expect(current.status).toBe("applied");
    expect(stale.status).toBe("stale");
    expect((await listHubRelayChannelBindings(db, groupId))[0]).toEqual(
      expect.objectContaining({
        externalChannelId: "channel-1",
        appliedConfigVersion: 2,
        configChecksum: "checksum-2",
        active: true,
      }),
    );
  });

  test("deactivates selected bindings without allowing an old version to win", async () => {
    const groupId = await createGroup();
    for (const routeKey of ["default", "special"]) {
      await upsertHubRelayChannelBinding(db, {
        groupId,
        routeKey,
        externalChannelId: `channel-${routeKey}`,
        configVersion: 1,
        configChecksum: `checksum-${routeKey}`,
      });
    }
    await db
      .update(hubProviderGroups)
      .set({ configVersion: 2 })
      .where(eq(hubProviderGroups.id, groupId));
    await upsertHubRelayChannelBinding(db, {
      groupId,
      routeKey: "default",
      externalChannelId: "channel-default",
      configVersion: 2,
      configChecksum: "checksum-default-v2",
    });

    const stale = await deactivateHubRelayChannelBindings(db, {
      groupId,
      configVersion: 1,
    });
    expect(stale).toEqual({ status: "stale", count: 0 });
    const selected = await deactivateHubRelayChannelBindings(db, {
      groupId,
      configVersion: 2,
      routeKeys: ["special"],
    });
    expect(selected).toEqual({ status: "applied", count: 1 });
    expect(
      (await listHubRelayChannelBindings(db, groupId)).map((binding) => [
        binding.routeKey,
        binding.active,
        binding.appliedConfigVersion,
      ]),
    ).toEqual([
      ["default", true, 2],
      ["special", false, 2],
    ]);
  });

  async function createGroup() {
    const suffix = crypto.randomUUID();
    const providerId = crypto.randomUUID();
    const groupId = crypto.randomUUID();
    await db.execute(sql`
      INSERT INTO hub_providers (
        id, owner_workspace_id, slug, name, display_name
      ) VALUES (
        ${providerId}, ${`workspace-${suffix}`}, ${`provider-${suffix}`},
        'Provider', 'Provider'
      )
    `);
    createdProviderIds.push(providerId);
    await db.execute(sql`
      INSERT INTO hub_provider_groups (
        id, provider_id, name, base_url_ciphertext, base_url_host_hash,
        config_version
      ) VALUES (
        ${groupId}, ${providerId}, 'Pro', 'encrypted-base-url', 'host-hash', 1
      )
    `);
    createdGroupIds.push(groupId);
    return groupId;
  }

  async function enqueue(
    groupId: string,
    configVersion: number,
    action: "upsert" | "disable",
  ) {
    await db.insert(hubConfigOutbox).values({
      groupId,
      configVersion,
      action,
      nextAttemptAt: baseTime,
    });
  }
});
