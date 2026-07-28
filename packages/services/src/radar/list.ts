import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  or,
  sql,
} from "@openstatus/db";
import {
  page,
  radarAccount,
  radarCredential,
  radarPool,
  radarProbeRun,
  radarProbeTarget,
  radarProvider,
  radarTargetStatus,
  selectRadarCredentialSchema,
  selectRadarPoolSchema,
  selectRadarProbeRunSchema,
  selectRadarProbeTargetSchema,
  selectRadarProviderSchema,
  selectRadarTargetStatusSchema,
  user,
} from "@openstatus/db/src/schema";

import { type DB, getReadDb, type ServiceContext } from "../context";
import { NotFoundError } from "../errors";
import { getRadarActorAccess, type RadarVerificationStatus } from "./access";
import { decryptSecret } from "./crypto";
import {
  GetRadarPoolInput,
  ListClaimableRadarPoolsInput,
  ListRadarPoolsInput,
} from "./schemas";

export type RadarPoolListItem = ReturnType<
  typeof selectRadarPoolSchema.parse
> & {
  owner: {
    userId: number;
    name: string | null;
    email: string;
    verificationStatus: RadarVerificationStatus;
  } | null;
  providerCount: number;
  targetCount: number;
  lastCheckAt: Date | null;
  worstStatus:
    | "unknown"
    | "operational"
    | "degraded"
    | "down"
    | "paused"
    | "configuration_error";
};

export type RadarPoolDetail = ReturnType<typeof selectRadarPoolSchema.parse> & {
  pageId: number | null;
  homepageUrl: string | null;
  contactUrl: string | null;
  providers: Array<
    Omit<
      ReturnType<typeof selectRadarProviderSchema.parse>,
      "baseUrlEncrypted"
    > & {
      baseUrl: string;
    }
  >;
  credentials: Array<
    Omit<
      ReturnType<typeof selectRadarCredentialSchema.parse>,
      "encryptedApiKey"
    >
  >;
  targets: Array<
    ReturnType<typeof selectRadarProbeTargetSchema.parse> & {
      recentRuns: Array<
        Pick<
          ReturnType<typeof selectRadarProbeRunSchema.parse>,
          | "id"
          | "startedAt"
          | "success"
          | "httpStatus"
          | "errorType"
          | "firstTokenMs"
          | "totalLatencyMs"
        >
      >;
      stats7d: {
        sampleCount: number;
        successRate: number | null;
        p50FirstTokenMs: number | null;
        p95FirstTokenMs: number | null;
      };
      status: ReturnType<typeof selectRadarTargetStatusSchema.parse> | null;
    }
  >;
};

function safeProvider(row: typeof radarProvider.$inferSelect) {
  const { baseUrlEncrypted: _baseUrlEncrypted, ...safe } =
    selectRadarProviderSchema.parse(row);
  return safe;
}

const statusRank = {
  down: 5,
  configuration_error: 4,
  degraded: 3,
  unknown: 2,
  paused: 1,
  operational: 0,
} as const;

function worseStatus<T extends keyof typeof statusRank>(left: T, right: T): T {
  return statusRank[right] > statusRank[left] ? right : left;
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? null;
}

export async function listRadarPools(args: {
  ctx: ServiceContext;
  input?: ListRadarPoolsInput;
}) {
  const { ctx } = args;
  const input = ListRadarPoolsInput.parse(args.input ?? {});
  const db = getReadDb(ctx);
  const access = await getRadarActorAccess({ ctx, db });
  const condition = access.isAdmin
    ? isNull(radarPool.deletedAt)
    : and(
        eq(radarPool.ownerUserId, access.userId),
        isNull(radarPool.deletedAt),
      );

  const [countRow, rows] = await Promise.all([
    db.select({ count: count() }).from(radarPool).where(condition).get(),
    db
      .select()
      .from(radarPool)
      .where(condition)
      .orderBy(desc(radarPool.createdAt))
      .limit(input.limit)
      .offset(input.offset)
      .all(),
  ]);

  if (rows.length === 0) {
    return { items: [], totalSize: countRow?.count ?? 0, access };
  }

  const poolIds = rows.map((row) => row.id);
  const ownerUserIds = rows
    .map((row) => row.ownerUserId)
    .filter((ownerUserId): ownerUserId is number => ownerUserId != null);
  const [providerCounts, targetCounts, statuses, owners] = await Promise.all([
    db
      .select({
        poolId: radarProvider.poolId,
        count: sql<number>`count(*)`,
      })
      .from(radarProvider)
      .where(inArray(radarProvider.poolId, poolIds))
      .groupBy(radarProvider.poolId)
      .all(),
    db
      .select({
        poolId: radarProbeTarget.poolId,
        count: sql<number>`count(*)`,
      })
      .from(radarProbeTarget)
      .where(
        and(
          inArray(radarProbeTarget.poolId, poolIds),
          eq(radarProbeTarget.enabled, true),
        ),
      )
      .groupBy(radarProbeTarget.poolId)
      .all(),
    db
      .select({
        poolId: radarProbeTarget.poolId,
        status: radarTargetStatus.currentStatus,
        lastCheckAt: radarTargetStatus.lastCheckAt,
      })
      .from(radarProbeTarget)
      .leftJoin(
        radarTargetStatus,
        eq(radarTargetStatus.targetId, radarProbeTarget.id),
      )
      .where(
        and(
          inArray(radarProbeTarget.poolId, poolIds),
          eq(radarProbeTarget.enabled, true),
        ),
      )
      .all(),
    ownerUserIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            userId: user.id,
            name: user.name,
            email: user.email,
            verificationStatus: radarAccount.verificationStatus,
          })
          .from(user)
          .leftJoin(radarAccount, eq(radarAccount.userId, user.id))
          .where(inArray(user.id, ownerUserIds))
          .all(),
  ]);

  const providerCountByPool = new Map(
    providerCounts.map((row) => [row.poolId, row.count]),
  );
  const targetCountByPool = new Map(
    targetCounts.map((row) => [row.poolId, row.count]),
  );
  const ownerByUserId = new Map(
    owners.map((owner) => [
      owner.userId,
      {
        userId: owner.userId,
        name: owner.name,
        email: owner.email ?? "",
        verificationStatus:
          (owner.verificationStatus as RadarVerificationStatus | null) ??
          "unverified",
      },
    ]),
  );
  const summaryByPool = new Map<
    number,
    { worstStatus: RadarPoolListItem["worstStatus"]; lastCheckAt: Date | null }
  >();

  for (const row of statuses) {
    const current = summaryByPool.get(row.poolId) ?? {
      worstStatus: "operational" as RadarPoolListItem["worstStatus"],
      lastCheckAt: null,
    };
    current.worstStatus = worseStatus(
      current.worstStatus,
      row.status ?? "unknown",
    );
    if (
      row.lastCheckAt &&
      (!current.lastCheckAt || row.lastCheckAt > current.lastCheckAt)
    ) {
      current.lastCheckAt = row.lastCheckAt;
    }
    summaryByPool.set(row.poolId, current);
  }

  const items: RadarPoolListItem[] = rows.map((row) => {
    const pool = selectRadarPoolSchema.parse(row);
    const summary = summaryByPool.get(pool.id);
    return {
      ...pool,
      owner:
        pool.ownerUserId == null
          ? null
          : (ownerByUserId.get(pool.ownerUserId) ?? null),
      providerCount: providerCountByPool.get(pool.id) ?? 0,
      targetCount: targetCountByPool.get(pool.id) ?? 0,
      worstStatus: summary?.worstStatus ?? "unknown",
      lastCheckAt: summary?.lastCheckAt ?? null,
    };
  });

  return { items, totalSize: countRow?.count ?? 0, access };
}

async function hydrateClaimablePools(
  db: DB,
  rows: Array<typeof radarPool.$inferSelect>,
) {
  if (rows.length === 0) return [];

  const poolIds = rows.map((row) => row.id);
  const [providerCounts, targetCounts, statuses] = await Promise.all([
    db
      .select({
        poolId: radarProvider.poolId,
        count: sql<number>`count(*)`,
      })
      .from(radarProvider)
      .where(inArray(radarProvider.poolId, poolIds))
      .groupBy(radarProvider.poolId)
      .all(),
    db
      .select({
        poolId: radarProbeTarget.poolId,
        count: sql<number>`count(*)`,
      })
      .from(radarProbeTarget)
      .where(
        and(
          inArray(radarProbeTarget.poolId, poolIds),
          eq(radarProbeTarget.enabled, true),
        ),
      )
      .groupBy(radarProbeTarget.poolId)
      .all(),
    db
      .select({
        poolId: radarProbeTarget.poolId,
        status: radarTargetStatus.currentStatus,
        lastCheckAt: radarTargetStatus.lastCheckAt,
      })
      .from(radarProbeTarget)
      .leftJoin(
        radarTargetStatus,
        eq(radarTargetStatus.targetId, radarProbeTarget.id),
      )
      .where(
        and(
          inArray(radarProbeTarget.poolId, poolIds),
          eq(radarProbeTarget.enabled, true),
        ),
      )
      .all(),
  ]);

  const providerCountByPool = new Map(
    providerCounts.map((row) => [row.poolId, row.count]),
  );
  const targetCountByPool = new Map(
    targetCounts.map((row) => [row.poolId, row.count]),
  );
  const summaryByPool = new Map<
    number,
    { worstStatus: RadarPoolListItem["worstStatus"]; lastCheckAt: Date | null }
  >();

  for (const row of statuses) {
    const current = summaryByPool.get(row.poolId) ?? {
      worstStatus: "operational" as RadarPoolListItem["worstStatus"],
      lastCheckAt: null,
    };
    current.worstStatus = worseStatus(
      current.worstStatus,
      row.status ?? "unknown",
    );
    if (
      row.lastCheckAt &&
      (!current.lastCheckAt || row.lastCheckAt > current.lastCheckAt)
    ) {
      current.lastCheckAt = row.lastCheckAt;
    }
    summaryByPool.set(row.poolId, current);
  }

  return rows.map((row): RadarPoolListItem => {
    const pool = selectRadarPoolSchema.parse(row);
    const summary = summaryByPool.get(pool.id);
    return {
      ...pool,
      owner: null,
      providerCount: providerCountByPool.get(pool.id) ?? 0,
      targetCount: targetCountByPool.get(pool.id) ?? 0,
      worstStatus: summary?.worstStatus ?? "unknown",
      lastCheckAt: summary?.lastCheckAt ?? null,
    };
  });
}

export async function listClaimableRadarPools(args: {
  ctx: ServiceContext;
  input?: ListClaimableRadarPoolsInput;
}) {
  const { ctx } = args;
  const input = ListClaimableRadarPoolsInput.parse(args.input ?? {});
  const db = getReadDb(ctx);
  const access = await getRadarActorAccess({ ctx, db });
  if (access.isAdmin) {
    return { items: [], totalSize: 0, access };
  }

  const condition = and(
    eq(radarPool.claimable, true),
    isNull(radarPool.deletedAt),
    input.query
      ? or(
          like(radarPool.name, `%${input.query}%`),
          like(radarPool.slug, `%${input.query}%`),
        )
      : undefined,
  );
  const [countRow, rows] = await Promise.all([
    db.select({ count: count() }).from(radarPool).where(condition).get(),
    db
      .select()
      .from(radarPool)
      .where(condition)
      .orderBy(desc(radarPool.createdAt))
      .limit(input.limit)
      .offset(input.offset)
      .all(),
  ]);

  return {
    items: await hydrateClaimablePools(db, rows),
    totalSize: countRow?.count ?? 0,
    access,
  };
}

export async function getRadarPool(args: {
  ctx: ServiceContext;
  input: GetRadarPoolInput;
}): Promise<RadarPoolDetail> {
  const { ctx } = args;
  const input = GetRadarPoolInput.parse(args.input);
  const db = getReadDb(ctx);
  const access = await getRadarActorAccess({ ctx, db });

  const row = await db
    .select()
    .from(radarPool)
    .where(and(eq(radarPool.slug, input.slug), isNull(radarPool.deletedAt)))
    .get();
  if (!row || (!access.isAdmin && row.ownerUserId !== access.userId)) {
    throw new NotFoundError("radar_pool", input.slug);
  }

  const [providers, credentials, targets, catalogTargets, publicPage] =
    await Promise.all([
      db
        .select()
        .from(radarProvider)
        .where(eq(radarProvider.poolId, row.id))
        .all(),
      db
        .select()
        .from(radarCredential)
        .innerJoin(
          radarProvider,
          eq(radarCredential.providerId, radarProvider.id),
        )
        .where(eq(radarProvider.poolId, row.id))
        .all(),
      db
        .select({
          target: radarProbeTarget,
          status: radarTargetStatus,
        })
        .from(radarProbeTarget)
        .leftJoin(
          radarTargetStatus,
          eq(radarTargetStatus.targetId, radarProbeTarget.id),
        )
        .where(
          and(
            eq(radarProbeTarget.poolId, row.id),
            eq(radarProbeTarget.enabled, true),
          ),
        )
        .all(),
      db
        .select({
          credentialId: radarProbeTarget.credentialId,
          modelName: radarProbeTarget.modelName,
        })
        .from(radarProbeTarget)
        .where(eq(radarProbeTarget.poolId, row.id))
        .all(),
      row.pageId == null
        ? Promise.resolve(null)
        : db
            .select({
              homepageUrl: page.homepageUrl,
              contactUrl: page.contactUrl,
            })
            .from(page)
            .where(eq(page.id, row.pageId))
            .get(),
    ]);
  const catalogByCredential = new Map<number, string[]>();
  for (const target of catalogTargets) {
    if (!target.credentialId) continue;
    const models = catalogByCredential.get(target.credentialId) ?? [];
    if (!models.includes(target.modelName)) models.push(target.modelName);
    catalogByCredential.set(target.credentialId, models);
  }

  const parsedTargets = targets.map((row) => ({
    ...selectRadarProbeTargetSchema.parse(row.target),
    status: row.status ? selectRadarTargetStatusSchema.parse(row.status) : null,
  }));
  const targetIds = parsedTargets.map((target) => target.id);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const runRows =
    targetIds.length === 0
      ? []
      : await db
          .select()
          .from(radarProbeRun)
          .where(
            and(
              eq(radarProbeRun.poolId, row.id),
              inArray(radarProbeRun.targetId, targetIds),
              gte(radarProbeRun.startedAt, sevenDaysAgo),
            ),
          )
          .orderBy(desc(radarProbeRun.startedAt))
          .limit(5000)
          .all();
  const runsByTarget = new Map<
    number,
    Array<ReturnType<typeof selectRadarProbeRunSchema.parse>>
  >();

  for (const runRow of runRows) {
    const run = selectRadarProbeRunSchema.parse(runRow);
    const runs = runsByTarget.get(run.targetId) ?? [];
    runs.push(run);
    runsByTarget.set(run.targetId, runs);
  }

  return {
    ...selectRadarPoolSchema.parse(row),
    homepageUrl: publicPage?.homepageUrl ?? null,
    contactUrl: publicPage?.contactUrl ?? null,
    providers: await Promise.all(
      providers.map(async (provider) => ({
        ...safeProvider(provider),
        baseUrl: await decryptSecret(provider.baseUrlEncrypted),
      })),
    ),
    credentials: credentials.map((row) => {
      const { encryptedApiKey: _encryptedApiKey, ...safe } =
        selectRadarCredentialSchema.parse(row.radar_credential);
      return {
        ...safe,
        keyFingerprint:
          !access.isAdmin && safe.handoverExpiresAt ? "" : safe.keyFingerprint,
        lastFour:
          !access.isAdmin && safe.handoverExpiresAt ? "" : safe.lastFour,
        modelCatalog: safe.modelCatalog.length
          ? safe.modelCatalog
          : (catalogByCredential.get(safe.id) ?? []),
      };
    }),
    targets: parsedTargets.map((target) => {
      const runs = runsByTarget.get(target.id) ?? [];
      const successCount = runs.filter((run) => run.success).length;
      const firstTokenValues = runs
        .map((run) => run.firstTokenMs)
        .filter((value): value is number => typeof value === "number");

      return {
        ...target,
        recentRuns: runs.slice(0, 60).map((run) => ({
          id: run.id,
          startedAt: run.startedAt,
          success: run.success,
          httpStatus: run.httpStatus,
          errorType: run.errorType,
          firstTokenMs: run.firstTokenMs,
          totalLatencyMs: run.totalLatencyMs,
        })),
        stats7d: {
          sampleCount: runs.length,
          successRate:
            runs.length === 0
              ? null
              : Math.round((successCount / runs.length) * 10_000),
          p50FirstTokenMs: percentile(firstTokenValues, 50),
          p95FirstTokenMs: percentile(firstTokenValues, 95),
        },
      };
    }),
  };
}
