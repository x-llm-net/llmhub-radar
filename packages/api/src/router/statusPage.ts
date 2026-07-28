import { Events } from "@openstatus/analytics";
import { and, desc, eq, gte, inArray, isNull, sql } from "@openstatus/db";
import {
  maintenance,
  page,
  pageComponent,
  pageSubscriber,
  pageConfigurationSchema,
  radarCredential,
  radarPool,
  radarProbeRun,
  radarProbeTarget,
  radarProvider,
  radarTargetOpenStatusBinding,
  radarTargetStatus,
  selectMaintenancePageSchema,
  selectPageComponentWithMonitorRelation,
  selectPageSchema,
  selectPublicMonitorSchema,
  selectPublicPageLightSchemaWithRelation,
  selectPublicPageSchemaWithRelation,
  selectStatusReportPageSchema,
  selectWorkspaceSchema,
  statusReport,
} from "@openstatus/db/src/schema";
import { EmailClient } from "@openstatus/emails";
import {
  getSubscriberByToken,
  unsubscribeSubscriber,
  updateSubscriberScope,
  upsertSelfSignupSubscriber,
  verifySelfSignupSubscriber,
} from "@openstatus/services/page-subscriber";
import {
  sendEmailVerification,
  sendWebhookVerification,
} from "@openstatus/subscriptions";
import { TRPCError } from "@trpc/server";
import { endOfDay, startOfDay, subDays } from "date-fns";
import { z } from "zod";

import { env } from "../env";
import { createTRPCRouter, publicProcedure } from "../trpc";
import { getPublicStatusPageUrl } from "./statusPage.links";
import {
  type StatusData,
  activeReportStatus,
  fillStatusDataFor45Days,
  fillStatusDataFor45DaysNoop,
  getEvents,
  getUptime,
  getWorstVariant,
  isMonitorComponent,
  setDataByType,
} from "./statusPage.utils";
import {
  getMetricsLatencyMultiProcedure,
  getMetricsLatencyProcedure,
  getMetricsRegionsProcedure,
  getStatusProcedure,
  getUptimeProcedure,
} from "./tinybird";

// NOTE: publicProcedure is used to get the status page
// TODO: improve performance of SQL query (make a single query with joins)

// IMPORTANT: we cannot use the tinybird procedure because it has protectedProcedure
// instead, we should add TB logic in here!!!!

// NOTE: this router is used on status pages only - do not confuse with the page router which is used in the dashboard for the config

/**
 * Right now, we do not allow workspaces to have a custom lookback period.
 * If we decide to allow this in the future, we should move this to the database.
 */
const WORKSPACES =
  process.env.WORKSPACES_LOOKBACK_30?.split(",").map(Number) || [];

const emailClient = new EmailClient({ apiKey: env.RESEND_API_KEY });

type StatusVariant = "success" | "degraded" | "error" | "info";
type RadarTargetStatus =
  | "unknown"
  | "operational"
  | "degraded"
  | "down"
  | "paused"
  | "configuration_error";

const statusVariantRank: Record<StatusVariant, number> = {
  success: 0,
  info: 1,
  degraded: 2,
  error: 3,
};

function worseStatusVariant(
  current: StatusVariant,
  next: StatusVariant,
): StatusVariant {
  return statusVariantRank[next] > statusVariantRank[current] ? next : current;
}

function aggregateRadarStatus(statuses: RadarTargetStatus[]): StatusVariant {
  const activeStatuses = statuses.filter((status) => status !== "paused");
  if (activeStatuses.length === 0) return "degraded";

  const allActiveTargetsDown = activeStatuses.every(
    (status) => status === "down" || status === "configuration_error",
  );
  if (allActiveTargetsDown) return "error";

  return activeStatuses.some((status) => status !== "operational")
    ? "degraded"
    : "success";
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? null;
}

function uniqueModels(models: Array<string | null | undefined>) {
  return Array.from(
    new Set(models.filter((model): model is string => Boolean(model))),
  );
}

const RADAR_STABILITY_BUCKET_HOURS = 3;
const RADAR_STABILITY_BUCKET_COUNT = 56;
const RADAR_STABILITY_BUCKET_MS = RADAR_STABILITY_BUCKET_HOURS * 60 * 60 * 1000;

function buildRadarStabilityBuckets(
  runs: Array<{
    startedAt: Date;
    success: boolean;
    firstTokenMs: number | null;
    totalLatencyMs: number | null;
    errorType: string | null;
  }>,
) {
  const currentBucketStart =
    Math.floor(Date.now() / RADAR_STABILITY_BUCKET_MS) *
    RADAR_STABILITY_BUCKET_MS;
  const firstBucketStart =
    currentBucketStart -
    RADAR_STABILITY_BUCKET_COUNT * RADAR_STABILITY_BUCKET_MS;

  const buckets = Array.from({ length: RADAR_STABILITY_BUCKET_COUNT + 1 }).map(
    (_, index) => ({
      from: new Date(firstBucketStart + index * RADAR_STABILITY_BUCKET_MS),
      to: new Date(firstBucketStart + (index + 1) * RADAR_STABILITY_BUCKET_MS),
      ok: 0,
      degraded: 0,
      error: 0,
      availability: null as number | null,
    }),
  );

  for (const run of runs) {
    const index = Math.floor(
      (run.startedAt.getTime() - firstBucketStart) / RADAR_STABILITY_BUCKET_MS,
    );
    const bucket = buckets[index];
    if (!bucket) continue;

    if (run.success) {
      if (
        (run.firstTokenMs != null && run.firstTokenMs > 15_000) ||
        (run.totalLatencyMs != null && run.totalLatencyMs > 30_000)
      ) {
        bucket.degraded += 1;
      } else {
        bucket.ok += 1;
      }
    } else {
      bucket.error += 1;
    }
  }

  const currentBucket = buckets.at(-1);
  const visibleBuckets =
    currentBucket &&
    currentBucket.ok + currentBucket.degraded + currentBucket.error === 0
      ? buckets.slice(0, RADAR_STABILITY_BUCKET_COUNT)
      : buckets.slice(1);

  return visibleBuckets.map((bucket) => {
    const total = bucket.ok + bucket.degraded + bucket.error;
    const available = bucket.ok + bucket.degraded;
    return {
      ...bucket,
      availability:
        total === 0 ? null : Math.round((available / total) * 10_000),
    };
  });
}

async function getPublicRadarByPageId(args: {
  db: typeof import("@openstatus/db").db;
  pageId: number;
}) {
  const pool = await args.db
    .select()
    .from(radarPool)
    .where(and(eq(radarPool.pageId, args.pageId), isNull(radarPool.deletedAt)))
    .get();

  if (!pool) return null;

  const targetRows = await args.db
    .select({
      target: radarProbeTarget,
      provider: radarProvider,
      credential: radarCredential,
      status: radarTargetStatus,
    })
    .from(radarProbeTarget)
    .innerJoin(radarProvider, eq(radarProvider.id, radarProbeTarget.providerId))
    .leftJoin(
      radarCredential,
      eq(radarCredential.id, radarProbeTarget.credentialId),
    )
    .leftJoin(
      radarTargetStatus,
      eq(radarTargetStatus.targetId, radarProbeTarget.id),
    )
    .where(
      and(
        eq(radarProbeTarget.poolId, pool.id),
        eq(radarProbeTarget.enabled, true),
      ),
    )
    .all();
  const catalogRows = await args.db
    .select({
      credentialId: radarProbeTarget.credentialId,
      modelName: radarProbeTarget.modelName,
    })
    .from(radarProbeTarget)
    .where(eq(radarProbeTarget.poolId, pool.id))
    .all();
  const catalogByCredential = new Map<number, string[]>();
  for (const row of catalogRows) {
    if (!row.credentialId) continue;
    const models = catalogByCredential.get(row.credentialId) ?? [];
    if (!models.includes(row.modelName)) models.push(row.modelName);
    catalogByCredential.set(row.credentialId, models);
  }

  const targetIds = targetRows.map((row) => row.target.id);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentRuns =
    targetIds.length > 0
      ? await args.db
          .select({
            id: radarProbeRun.id,
            targetId: radarProbeRun.targetId,
            startedAt: radarProbeRun.startedAt,
            success: radarProbeRun.success,
            httpStatus: radarProbeRun.httpStatus,
            errorType: radarProbeRun.errorType,
            firstTokenMs: radarProbeRun.firstTokenMs,
            totalLatencyMs: radarProbeRun.totalLatencyMs,
          })
          .from(radarProbeRun)
          .where(
            and(
              inArray(radarProbeRun.targetId, targetIds),
              gte(radarProbeRun.startedAt, sevenDaysAgo),
            ),
          )
          .orderBy(desc(radarProbeRun.startedAt))
          .limit(5000)
          .all()
      : [];

  const runsByTargetId = new Map<number, typeof recentRuns>();
  for (const run of recentRuns) {
    const runs = runsByTargetId.get(run.targetId) ?? [];
    runs.push(run);
    runsByTargetId.set(run.targetId, runs);
  }

  const targetStatuses: RadarTargetStatus[] = [];
  const targets = targetRows.map((row) => {
    const currentStatus =
      row.status?.currentStatus ?? row.target.currentStatus ?? "unknown";
    targetStatuses.push(currentStatus);
    const runs = runsByTargetId.get(row.target.id) ?? [];
    const successCount = runs.filter((run) => run.success).length;
    const firstTokenValues = runs
      .map((run) => run.firstTokenMs)
      .filter((value): value is number => typeof value === "number");
    const modelCatalog = uniqueModels([
      row.target.modelName,
      ...(row.credential?.modelCatalog?.length
        ? row.credential.modelCatalog
        : row.credential
          ? (catalogByCredential.get(row.credential.id) ?? [])
          : []),
    ]);
    const serviceGroupName =
      row.credential?.billingGroup ||
      row.credential?.name ||
      row.target.displayName;

    return {
      id: row.target.id,
      providerName: row.provider.displayName,
      name: row.target.name,
      displayName: row.target.displayName,
      serviceGroupName,
      tokenGroupName: serviceGroupName,
      modelFamily: row.credential?.modelGroup || "General",
      modelName: row.target.modelName,
      modelCatalog,
      currentStatus,
      intervalSeconds: row.target.intervalSeconds,
      nextCheckAt: row.target.nextCheckAt ?? null,
      lastCheckAt: row.status?.lastCheckAt ?? null,
      lastSuccessAt: row.status?.lastSuccessAt ?? null,
      lastFailureAt: row.status?.lastFailureAt ?? null,
      stats7d: {
        sampleCount: runs.length,
        successRate:
          runs.length === 0
            ? null
            : Math.round((successCount / runs.length) * 10_000),
        p50FirstTokenMs: percentile(firstTokenValues, 50),
        p95FirstTokenMs: percentile(firstTokenValues, 95),
      },
      stabilityBuckets7d: buildRadarStabilityBuckets(runs),
      sampleCount1h: row.status?.sampleCount1h ?? 0,
      sampleCount24h: row.status?.sampleCount24h ?? 0,
      successRate1h: row.status?.successRate1h ?? 0,
      successRate24h: row.status?.successRate24h ?? 0,
      p50FirstTokenMs: row.status?.p50FirstTokenMs ?? null,
      p95FirstTokenMs: row.status?.p95FirstTokenMs ?? null,
      p50TotalLatencyMs: row.status?.p50TotalLatencyMs ?? null,
      p95TotalLatencyMs: row.status?.p95TotalLatencyMs ?? null,
      recentRuns: runs.slice(0, 60),
    };
  });
  const status = aggregateRadarStatus(targetStatuses);

  return {
    pool: {
      id: pool.id,
      name: pool.name,
      slug: pool.slug,
      description: pool.description,
      pricingUrl: pool.pricingUrl ?? null,
      redirectUrlTemplate: pool.redirectUrlTemplate ?? null,
    },
    status,
    targets,
  };
}

// Length-independent comparison so a wrong guess can't be timed by length or
// character. Pure JS (no node:crypto) keeps it usable from the Edge runtime.
function constantTimeEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (a == null || b == null) return false;
  // constant-time: iterate over the max length and fold the length delta into
  // the accumulator so we never early-return or branch on length.
  const max = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < max; i++) {
    // out-of-range indices read as 0; mismatch already non-zero on length diff.
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

// Gate fields for getGate, reusing selectPageSchema's stringToArray transforms
// so authEmailDomains / allowedIpRanges come back as arrays like getLight.
const gateFieldsSchema = selectPageSchema.pick({
  slug: true,
  customDomain: true,
  accessType: true,
  authEmailDomains: true,
  allowedIpRanges: true,
  homepageUrl: true,
  contactUrl: true,
});

const publicRadarDirectoryInputSchema = z.object({
  limit: z.number().int().min(1).max(24).default(12),
  offset: z.number().int().min(0).default(0),
});

const publicRadarDirectoryItemSchema = z.object({
  page: z.object({
    title: z.string(),
    description: z.string(),
    slug: z.string(),
    defaultLocale: z.string(),
    icon: z.string().nullable(),
    updatedAt: z.date().nullable(),
  }),
  pool: z.object({
    name: z.string(),
    slug: z.string(),
    description: z.string(),
  }),
  status: z.enum(["success", "degraded", "error", "info"]),
  providerCount: z.number(),
  credentialCount: z.number(),
  targetCount: z.number(),
  modelFamilies: z.array(z.string()),
  sampleCount7d: z.number(),
  availability7d: z.number().nullable(),
  p50FirstTokenMs: z.number().nullable(),
  p95FirstTokenMs: z.number().nullable(),
  lastCheckAt: z.date().nullable(),
  dailyStatus7d: z.array(
    z.object({
      date: z.string(),
      ok: z.number(),
      degraded: z.number(),
      error: z.number(),
    }),
  ),
});

function dayKey(date: Date) {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized.toISOString().slice(0, 10);
}

function buildEmptyDailyStatus(days: number) {
  return Array.from({ length: days }).map((_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (days - 1 - index));
    return { date: dayKey(date), ok: 0, degraded: 0, error: 0 };
  });
}

export const statusPageRouter = createTRPCRouter({
  listPublicRadar: publicProcedure
    .input(publicRadarDirectoryInputSchema.optional())
    .output(
      z.object({
        items: z.array(publicRadarDirectoryItemSchema),
        totalSize: z.number(),
        limit: z.number(),
        offset: z.number(),
      }),
    )
    .query(async (opts) => {
      const input = publicRadarDirectoryInputSchema.parse(opts.input ?? {});
      const where = and(
        eq(page.published, true),
        eq(page.accessType, "public"),
        eq(radarPool.publicPoolOptIn, true),
        isNull(radarPool.deletedAt),
      );

      const [countRow, rows] = await Promise.all([
        opts.ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(page)
          .innerJoin(radarPool, eq(radarPool.pageId, page.id))
          .where(where)
          .get(),
        opts.ctx.db
          .select({
            pageId: page.id,
            pageTitle: page.title,
            pageDescription: page.description,
            pageIcon: page.icon,
            pageSlug: page.slug,
            pageDefaultLocale: page.defaultLocale,
            pageUpdatedAt: page.updatedAt,
            poolId: radarPool.id,
            poolName: radarPool.name,
            poolSlug: radarPool.slug,
            poolDescription: radarPool.description,
          })
          .from(page)
          .innerJoin(radarPool, eq(radarPool.pageId, page.id))
          .where(where)
          .orderBy(desc(page.updatedAt), desc(page.id))
          .limit(input.limit)
          .offset(input.offset)
          .all(),
      ]);

      if (rows.length === 0) {
        return {
          items: [],
          totalSize: countRow?.count ?? 0,
          limit: input.limit,
          offset: input.offset,
        };
      }

      const poolIds = rows.map((row) => row.poolId);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [providers, credentials, targets, recentRuns] = await Promise.all([
        opts.ctx.db
          .select({
            poolId: radarProvider.poolId,
            id: radarProvider.id,
            displayName: radarProvider.displayName,
            providerType: radarProvider.providerType,
          })
          .from(radarProvider)
          .where(
            and(
              inArray(radarProvider.poolId, poolIds),
              eq(radarProvider.enabled, true),
            ),
          )
          .all(),
        opts.ctx.db
          .select({
            poolId: radarProvider.poolId,
            credentialId: radarCredential.id,
            modelGroup: radarCredential.modelGroup,
            modelCatalog: radarCredential.modelCatalog,
          })
          .from(radarCredential)
          .innerJoin(
            radarProvider,
            eq(radarProvider.id, radarCredential.providerId),
          )
          .where(
            and(
              inArray(radarProvider.poolId, poolIds),
              eq(radarCredential.enabled, true),
            ),
          )
          .all(),
        opts.ctx.db
          .select({
            poolId: radarProbeTarget.poolId,
            targetId: radarProbeTarget.id,
            credentialId: radarProbeTarget.credentialId,
            modelName: radarProbeTarget.modelName,
            targetStatus: radarProbeTarget.currentStatus,
            lastCheckStartedAt: radarProbeTarget.lastCheckStartedAt,
            status: radarTargetStatus.currentStatus,
            lastCheckAt: radarTargetStatus.lastCheckAt,
            p50FirstTokenMs: radarTargetStatus.p50FirstTokenMs,
            p95FirstTokenMs: radarTargetStatus.p95FirstTokenMs,
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
        opts.ctx.db
          .select({
            poolId: radarProbeRun.poolId,
            startedAt: radarProbeRun.startedAt,
            success: radarProbeRun.success,
            errorType: radarProbeRun.errorType,
            firstTokenMs: radarProbeRun.firstTokenMs,
            totalLatencyMs: radarProbeRun.totalLatencyMs,
          })
          .from(radarProbeRun)
          .where(
            and(
              inArray(radarProbeRun.poolId, poolIds),
              gte(radarProbeRun.startedAt, sevenDaysAgo),
            ),
          )
          .orderBy(desc(radarProbeRun.startedAt))
          .limit(50_000)
          .all(),
      ]);

      const providersByPool = new Map<number, typeof providers>();
      const credentialsByPool = new Map<number, typeof credentials>();
      const targetsByPool = new Map<number, typeof targets>();
      const runsByPool = new Map<number, typeof recentRuns>();

      for (const provider of providers) {
        const list = providersByPool.get(provider.poolId) ?? [];
        list.push(provider);
        providersByPool.set(provider.poolId, list);
      }
      for (const credential of credentials) {
        const list = credentialsByPool.get(credential.poolId) ?? [];
        list.push(credential);
        credentialsByPool.set(credential.poolId, list);
      }
      for (const target of targets) {
        const list = targetsByPool.get(target.poolId) ?? [];
        list.push(target);
        targetsByPool.set(target.poolId, list);
      }
      for (const run of recentRuns) {
        const list = runsByPool.get(run.poolId) ?? [];
        list.push(run);
        runsByPool.set(run.poolId, list);
      }

      const items = rows.map((row) => {
        const poolProviders = providersByPool.get(row.poolId) ?? [];
        const poolCredentials = credentialsByPool.get(row.poolId) ?? [];
        const poolTargets = targetsByPool.get(row.poolId) ?? [];
        const poolRuns = runsByPool.get(row.poolId) ?? [];
        const statuses = poolTargets.map(
          (target) => target.status ?? target.targetStatus ?? "unknown",
        );
        const firstTokenValues = poolRuns
          .map((run) => run.firstTokenMs)
          .filter((value): value is number => typeof value === "number");
        const successCount = poolRuns.filter((run) => run.success).length;
        const modelFamilies = Array.from(
          new Set(
            poolCredentials
              .flatMap((credential) => [
                credential.modelGroup,
                ...(credential.modelCatalog ?? []).slice(0, 2),
              ])
              .filter((value): value is string => Boolean(value)),
          ),
        ).slice(0, 6);
        const lastCheckAt = poolTargets.reduce<Date | null>(
          (latest, target) => {
            const candidate = target.lastCheckAt ?? target.lastCheckStartedAt;
            if (!candidate) return latest;
            if (!latest || candidate > latest) return candidate;
            return latest;
          },
          null,
        );
        const dailyStatus7d = buildEmptyDailyStatus(7);
        const dailyStatusByDate = new Map(
          dailyStatus7d.map((day) => [day.date, day]),
        );
        for (const run of poolRuns) {
          const bucket = dailyStatusByDate.get(dayKey(run.startedAt));
          if (!bucket) continue;
          if (run.success) {
            if (
              (run.firstTokenMs != null && run.firstTokenMs > 15_000) ||
              (run.totalLatencyMs != null && run.totalLatencyMs > 30_000)
            ) {
              bucket.degraded += 1;
            } else {
              bucket.ok += 1;
            }
          } else {
            bucket.error += 1;
          }
        }

        return {
          page: {
            title: row.pageTitle,
            description: row.pageDescription,
            slug: row.pageSlug,
            defaultLocale: row.pageDefaultLocale,
            icon: row.pageIcon || null,
            updatedAt: row.pageUpdatedAt ?? null,
          },
          pool: {
            name: row.poolName,
            slug: row.poolSlug,
            description: row.poolDescription,
          },
          status: statuses.length > 0 ? aggregateRadarStatus(statuses) : "info",
          providerCount: new Set(poolProviders.map((provider) => provider.id))
            .size,
          credentialCount: new Set(
            poolCredentials.map((credential) => credential.credentialId),
          ).size,
          targetCount: poolTargets.length,
          modelFamilies,
          sampleCount7d: poolRuns.length,
          availability7d:
            poolRuns.length === 0
              ? null
              : Math.round((successCount / poolRuns.length) * 10_000),
          p50FirstTokenMs: percentile(firstTokenValues, 50),
          p95FirstTokenMs: percentile(firstTokenValues, 95),
          lastCheckAt,
          dailyStatus7d,
        };
      });

      return {
        items,
        totalSize: countRow?.count ?? 0,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  get: publicProcedure
    .input(
      z.object({
        slug: z.string().toLowerCase(),
        // NOTE: override the defaults we are getting from the page configuration
        cardType: z
          .enum(["requests", "duration", "dominant", "manual"])
          .nullish(),
        barType: z.enum(["absolute", "dominant", "manual"]).nullish(),
      }),
    )
    .output(selectPublicPageSchemaWithRelation.nullish())
    .query(async (opts) => {
      if (!opts.input.slug) return null;

      const _page = await opts.ctx.db.query.page.findFirst({
        where: sql`lower(${page.slug}) = ${opts.input.slug} OR lower(${page.customDomain}) = ${opts.input.slug}`,
        with: {
          workspace: true,
          statusReports: {
            // TODO: we need to order the based on statusReportUpdates instead
            // orderBy: (reports, { desc }) => desc(reports.createdAt),
            with: {
              statusReportUpdates: {
                orderBy: (reports, { desc }) => desc(reports.date),
                with: { statusReportUpdateToPageComponents: true },
              },
              statusReportsToPageComponents: { with: { pageComponent: true } },
            },
          },
          maintenances: {
            with: {
              maintenancesToPageComponents: { with: { pageComponent: true } },
            },
            orderBy: (maintenances, { desc }) => desc(maintenances.from),
          },
          pageComponents: {
            with: {
              monitor: {
                with: {
                  incidents: true,
                },
              },
              group: true,
            },
            orderBy: (pageComponents, { asc }) => asc(pageComponents.order),
          },
          pageComponentGroups: true,
        },
      });

      if (!_page) return null;

      const ws = selectWorkspaceSchema.safeParse(_page.workspace);
      const pageComponents = selectPageComponentWithMonitorRelation
        .array()
        .parse(_page.pageComponents);

      const configuration = pageConfigurationSchema.safeParse(
        _page.configuration ?? {},
      );

      if (!configuration.success) {
        console.error("Invalid configuration", configuration.error);
        return null;
      }

      const barType = opts.input.barType ?? configuration.data.type;
      // const cardType = opts.input.cardType ?? configuration.data.value;

      const monitorComponents = pageComponents.filter(isMonitorComponent);

      // Transform all page components (both monitor and static types)
      const components = pageComponents.map((c) => {
        const events = getEvents({
          maintenances: _page.maintenances,
          incidents: c.monitor?.incidents ?? [],
          reports: _page.statusReports,
          pageComponentId: c.id,
          monitorId: c.monitorId ?? undefined,
          componentType: c.type,
        });

        // Calculate status based on component type
        let status: "success" | "degraded" | "error" | "info";

        // impact-aware: an active report colors the component by its derived
        // status (major ⇒ error); legacy reports keep flat degraded
        const reportStatus = activeReportStatus(events);

        if (c.type === "static") {
          // Static: only reports and maintenances affect status
          status =
            reportStatus ??
            (events.some(
              (e) =>
                e.type === "maintenance" &&
                e.to &&
                e.from.getTime() <= new Date().getTime() &&
                e.to.getTime() >= new Date().getTime(),
            )
              ? "info"
              : "success");
        } else {
          // Monitor: incidents, reports, and maintenances affect status
          status =
            events.some((e) => e.type === "incident" && !e.to) &&
            barType !== "manual"
              ? "error"
              : (reportStatus ??
                (events.some(
                  (e) =>
                    e.type === "maintenance" &&
                    e.to &&
                    e.from.getTime() <= new Date().getTime() &&
                    e.to.getTime() >= new Date().getTime(),
                )
                  ? "info"
                  : "success"));
        }

        return {
          ...c,
          status,
          events,
        };
      });

      // Keep monitors for backward compatibility with existing fields
      const monitors = monitorComponents.map((c) => {
        const events = getEvents({
          maintenances: _page.maintenances,
          incidents: c.monitor.incidents ?? [],
          reports: _page.statusReports,
          monitorId: c.monitor.id,
        });
        const status =
          events.some((e) => e.type === "incident" && !e.to) &&
          barType !== "manual"
            ? "error"
            : (activeReportStatus(events) ??
              (events.some(
                (e) =>
                  e.type === "maintenance" &&
                  e.to &&
                  e.from.getTime() <= new Date().getTime() &&
                  e.to.getTime() >= new Date().getTime(),
              )
                ? "info"
                : "success"));
        return {
          ...c.monitor,
          status,
          events,
          monitorGroupId: c.groupId,
          order: c.order,
          groupOrder: c.groupOrder,
        };
      });

      // no barType gate: incident-driven error is already suppressed per
      // monitor in manual mode; report-driven error (major_outage) must show
      const monitorStatus = monitors.some((m) => m.status === "error")
        ? "error"
        : monitors.some((m) => m.status === "degraded")
          ? "degraded"
          : monitors.some((m) => m.status === "info")
            ? "info"
            : "success";
      const radar = await getPublicRadarByPageId({
        db: opts.ctx.db,
        pageId: _page.id,
      });
      const status = radar
        ? worseStatusVariant(monitorStatus, radar.status)
        : monitorStatus;

      // Get page-wide events (not tied to specific monitors)
      const pageEvents = getEvents({
        maintenances: _page.maintenances,
        incidents: monitorComponents.flatMap((c) => c.monitor.incidents ?? []),
        reports: _page.statusReports,
        // No monitorId provided, so we get all events for the page
      });

      const threshold = new Date().getTime() - 7 * 24 * 60 * 60 * 1000;
      const lastEvents = pageEvents
        .filter((e) => {
          if (e.type === "incident") return false;
          if (!e.from || e.from.getTime() >= threshold) return true;
          if (e.type === "report" && e.status !== "success") return true;
          return false;
        })
        .sort((a, b) => a.from.getTime() - b.from.getTime());

      const openEvents = pageEvents.filter((event) => {
        if (event.type === "incident" && barType !== "manual") {
          if (!event.to) return true;
          if (event.to < new Date()) return false;
          return false;
        }
        if (event.type === "report") {
          if (!event.to) return true;
          if (event.to < new Date()) return false;
          return false;
        }
        if (event.type === "maintenance") {
          if (!event.to) return false; // NOTE: this never happens
          if (event.from <= new Date() && event.to >= new Date()) return true;
          return false;
        }
        return false;
      });

      const monitorGroups = _page.pageComponentGroups;

      // Create trackers array with grouped and ungrouped components
      const groupedMap = new Map<
        number | null,
        {
          groupId: number | null;
          groupName: string | null;
          defaultOpen: boolean;
          components: typeof components;
          minOrder: number;
        }
      >();

      components.forEach((component) => {
        const groupId = component.groupId ?? null;
        const group = groupId
          ? monitorGroups.find((g) => g?.id === groupId)
          : null;
        const groupName = group?.name ?? null;
        const defaultOpen = group?.defaultOpen ?? false;

        if (!groupedMap.has(groupId)) {
          groupedMap.set(groupId, {
            groupId,
            groupName,
            defaultOpen,
            components: [],
            minOrder: component.order ?? 0,
          });
        }
        const currentGroup = groupedMap.get(groupId);
        if (currentGroup) {
          currentGroup.components.push(component);
          currentGroup.minOrder = Math.min(
            currentGroup.minOrder,
            component.order ?? 0,
          );
        }
      });

      // Convert to trackers array
      type PageComponentTracker = {
        type: "component";
        component: (typeof components)[number];
        order: number;
      };

      type GroupTracker = {
        type: "group";
        groupId: number;
        groupName: string;
        defaultOpen: boolean;
        components: typeof components;
        status: "success" | "degraded" | "error" | "info" | "empty";
        order: number;
      };

      type Tracker = PageComponentTracker | GroupTracker;

      const trackers: Tracker[] = Array.from(groupedMap.values())
        .flatMap((group): Tracker[] => {
          if (group.groupId === null) {
            // Ungrouped components - return as individual trackers
            return group.components.map(
              (component): PageComponentTracker => ({
                type: "component",
                component,
                order: component.order ?? 0,
              }),
            );
          }
          // Grouped components - return as single group tracker
          const sortedComponents = group.components.sort(
            (a, b) => (a.groupOrder ?? 0) - (b.groupOrder ?? 0),
          );
          return [
            {
              type: "group",
              groupId: group.groupId,
              groupName: group.groupName ?? "",
              defaultOpen: group.defaultOpen,
              components: sortedComponents,
              status: getWorstVariant(
                group.components.map(
                  (c) => c.status as "success" | "degraded" | "error" | "info",
                ),
              ),
              order: group.minOrder,
            },
          ];
        })
        .sort((a, b) => a.order - b.order);

      const whiteLabel = ws.data?.limits["white-label"] ?? false;

      const statusReports = _page.statusReports.sort((a, b) => {
        // Sort reports without updates to the beginning
        if (
          a.statusReportUpdates.length === 0 &&
          b.statusReportUpdates.length === 0
        )
          return 0;
        if (a.statusReportUpdates.length === 0) return -1;
        if (b.statusReportUpdates.length === 0) return -1;
        return (
          b.statusReportUpdates[
            b.statusReportUpdates.length - 1
          ].date.getTime() -
          a.statusReportUpdates[a.statusReportUpdates.length - 1].date.getTime()
        );
      });

      const maintenances = _page.maintenances.sort(
        (a, b) => b.from.getTime() - a.from.getTime(),
      );

      // In "manual" mode the page only surfaces user-authored events, so drop
      // monitor-derived incidents from the components consumers read (e.g. the
      // calendar). Mirrors the bar/uptime gating in statusPage.utils.ts.
      const publicPageComponents =
        barType === "manual"
          ? pageComponents.map((c) =>
              c.monitor
                ? { ...c, monitor: { ...c.monitor, incidents: [] } }
                : c,
            )
          : pageComponents;

      return selectPublicPageSchemaWithRelation.parse({
        ..._page,
        monitors,
        monitorGroups,
        trackers,
        incidents: monitors.flatMap((m) => m.incidents) ?? [],
        statusReports,
        maintenances,
        workspacePlan: _page.workspace.plan,
        status,
        lastEvents,
        openEvents,
        pageComponents: publicPageComponents,
        pageComponentGroups: _page.pageComponentGroups,
        whiteLabel,
        radar,
      });
    }),

  getLight: publicProcedure
    .input(z.object({ slug: z.string().toLowerCase() }))
    .query(async (opts) => {
      if (!opts.input.slug) return null;

      // Single query with all relations
      const _page = await opts.ctx.db.query.page.findFirst({
        where: sql`lower(${page.slug}) = ${opts.input.slug} OR lower(${page.customDomain}) = ${opts.input.slug}`,
        with: {
          workspace: true,
          statusReports: {
            with: {
              statusReportUpdates: {
                orderBy: (reports, { desc }) => desc(reports.date),
                with: { statusReportUpdateToPageComponents: true },
              },
              statusReportsToPageComponents: { with: { pageComponent: true } },
            },
          },
          maintenances: {
            with: {
              maintenancesToPageComponents: { with: { pageComponent: true } },
            },
            orderBy: (maintenances, { desc }) => desc(maintenances.from),
          },
          pageComponents: {
            with: {
              monitor: { with: { incidents: true } },
              group: true,
            },
            orderBy: (pageComponents, { asc }) => asc(pageComponents.order),
          },
          pageComponentGroups: true,
        },
      });

      if (!_page) return null;

      // Extract monitor components for backwards compatibility
      const monitorComponents = _page.pageComponents.filter(
        (c) =>
          c.type === "monitor" &&
          c.monitor &&
          c.monitor.active &&
          !c.monitor.deletedAt,
      );

      // Build legacy monitors array (sorted by order)
      const monitors = monitorComponents
        .map((c) => ({
          ...c.monitor,
          name: c.monitor?.externalName ?? c.monitor?.name ?? "",
        }))
        .sort((a, b) => {
          const aComp = monitorComponents.find((m) => m.monitor?.id === a.id);
          const bComp = monitorComponents.find((m) => m.monitor?.id === b.id);
          return (aComp?.order ?? 0) - (bComp?.order ?? 0);
        });

      // Extract all incidents from monitor components
      const incidents = monitorComponents.flatMap(
        (c) => c.monitor?.incidents ?? [],
      );

      const ws = selectWorkspaceSchema.safeParse(_page.workspace);
      const whiteLabel = ws.data?.limits["white-label"] ?? false;

      return selectPublicPageLightSchemaWithRelation.parse({
        ..._page,
        monitors,
        incidents,
        statusReports: _page.statusReports,
        maintenances: _page.maintenances,
        pageComponents: _page.pageComponents,
        pageComponentGroups: _page.pageComponentGroups,
        workspacePlan: _page.workspace.plan,
        whiteLabel,
      });
    }),

  // Narrow access-check query for the markdown detail routes: returns only the
  // gate + chrome fields, skipping the full reports/maintenances/components graph
  // that getLight loads.
  getGate: publicProcedure
    .input(z.object({ slug: z.string().toLowerCase() }))
    .query(async (opts) => {
      if (!opts.input.slug) return null;

      const _page = await opts.ctx.db.query.page.findFirst({
        where: sql`lower(${page.slug}) = ${opts.input.slug} OR lower(${page.customDomain}) = ${opts.input.slug}`,
        columns: {
          slug: true,
          customDomain: true,
          accessType: true,
          authEmailDomains: true,
          allowedIpRanges: true,
          homepageUrl: true,
          contactUrl: true,
        },
        with: { workspace: true },
      });

      if (!_page) return null;

      const ws = selectWorkspaceSchema.safeParse(_page.workspace);
      const whiteLabel = ws.data?.limits["white-label"] ?? false;

      const { workspace: _workspace, ...rest } = _page;
      const gate = gateFieldsSchema.parse(rest);
      return { ...gate, whiteLabel };
    }),

  getMaintenance: publicProcedure
    .input(z.object({ slug: z.string().toLowerCase(), id: z.number() }))
    .query(async (opts) => {
      if (!opts.input.slug) return null;

      const _page = await opts.ctx.db
        .select()
        .from(page)
        .where(
          sql`lower(${page.slug}) = ${opts.input.slug} OR lower(${page.customDomain}) = ${opts.input.slug}`,
        )
        .get();

      if (!_page) return null;

      const _maintenance = await opts.ctx.db.query.maintenance.findFirst({
        where: and(
          eq(maintenance.id, opts.input.id),
          eq(maintenance.pageId, _page.id),
        ),
        with: {
          maintenancesToPageComponents: {
            with: { pageComponent: { with: { monitor: true } } },
          },
        },
      });

      if (!_maintenance) return null;

      const props: z.infer<typeof selectMaintenancePageSchema> = _maintenance;
      return selectMaintenancePageSchema.parse(props);
    }),

  getUptime: publicProcedure
    .input(
      z.object({
        slug: z.string().toLowerCase(),
        pageComponentIds: z.string().array(),
        cardType: z
          .enum(["requests", "duration", "dominant", "manual"])
          .prefault("requests"),
        barType: z
          .enum(["absolute", "dominant", "manual"])
          .prefault("dominant"),
      }),
    )
    .query(async (opts) => {
      const input = opts.input;
      if (!input.slug) return null;

      const _page = await opts.ctx.db.query.page.findFirst({
        where: sql`lower(${page.slug}) = ${input.slug} OR lower(${page.customDomain}) = ${input.slug}`,
        with: {
          maintenances: {
            with: {
              maintenancesToPageComponents: { with: { pageComponent: true } },
            },
          },
          statusReports: {
            with: {
              statusReportsToPageComponents: { with: { pageComponent: true } },
              statusReportUpdates: {
                with: { statusReportUpdateToPageComponents: true },
              },
            },
          },
          pageComponents: {
            where: inArray(
              pageComponent.id,
              input.pageComponentIds.map(Number),
            ),
            with: {
              monitor: {
                with: {
                  incidents: true,
                },
              },
            },
          },
        },
      });

      if (!_page) return null;

      const pageComponents = selectPageComponentWithMonitorRelation
        .array()
        .parse(_page.pageComponents);

      // Early return if no components to process
      if (pageComponents.length === 0) return [];

      const monitors = pageComponents.filter(isMonitorComponent);
      const componentIds = pageComponents.map((component) => component.id);

      const monitorsByType = {
        http: monitors.filter((c) => c.monitor.jobType === "http"),
        tcp: monitors.filter((c) => c.monitor.jobType === "tcp"),
        dns: monitors.filter((c) => c.monitor.jobType === "dns"),
      };

      const proceduresByType = {
        http: getStatusProcedure("45d", "http"),
        tcp: getStatusProcedure("45d", "tcp"),
        dns: getStatusProcedure("45d", "dns"),
      };

      const [statusHttp, statusTcp, statusDns] = await Promise.all(
        Object.entries(proceduresByType).map(([type, procedure]) => {
          const monitorIds = monitorsByType[
            type as keyof typeof proceduresByType
          ].map((c) => c.monitor.id.toString());
          if (monitorIds.length === 0) return null;
          // NOTE: if manual mode, don't fetch data from tinybird
          return input.barType === "manual" ? null : procedure({ monitorIds });
        }),
      );

      const statusDataByMonitorId = new Map<
        string,
        | Awaited<ReturnType<(typeof proceduresByType)["http"]>>["data"]
        | Awaited<ReturnType<(typeof proceduresByType)["tcp"]>>["data"]
        | Awaited<ReturnType<(typeof proceduresByType)["dns"]>>["data"]
      >();

      // Consolidate status data from all monitor types into the map
      for (const statusResult of [statusHttp, statusTcp, statusDns]) {
        if (statusResult?.data) {
          statusResult.data.forEach((status) => {
            const monitorId = status.monitorId;
            if (!statusDataByMonitorId.has(monitorId)) {
              statusDataByMonitorId.set(monitorId, []);
            }
            statusDataByMonitorId.get(monitorId)?.push(status);
          });
        }
      }

      const lookbackPeriod = WORKSPACES.includes(_page.workspaceId ?? 0)
        ? 30
        : 45;
      const radarBindingRows = await opts.ctx.db
        .select({
          pageComponentId: radarTargetOpenStatusBinding.pageComponentId,
          targetId: radarTargetOpenStatusBinding.targetId,
        })
        .from(radarTargetOpenStatusBinding)
        .where(eq(radarTargetOpenStatusBinding.pageId, _page.id))
        .all();
      const radarTargetIdByComponentId = new Map<number, number>();
      for (const row of radarBindingRows) {
        if (
          row.pageComponentId == null ||
          !componentIds.includes(row.pageComponentId)
        ) {
          continue;
        }
        radarTargetIdByComponentId.set(row.pageComponentId, row.targetId);
      }
      const radarTargetIds = [...radarTargetIdByComponentId.values()];
      const radarRuns =
        radarTargetIds.length === 0
          ? []
          : await opts.ctx.db
              .select({
                targetId: radarProbeRun.targetId,
                startedAt: radarProbeRun.startedAt,
                success: radarProbeRun.success,
              })
              .from(radarProbeRun)
              .where(
                and(
                  inArray(radarProbeRun.targetId, radarTargetIds),
                  gte(
                    radarProbeRun.startedAt,
                    subDays(new Date(), lookbackPeriod),
                  ),
                ),
              )
              .all();
      const radarRunsByTargetId = new Map<number, typeof radarRuns>();
      for (const run of radarRuns) {
        const runs = radarRunsByTargetId.get(run.targetId) ?? [];
        runs.push(run);
        radarRunsByTargetId.set(run.targetId, runs);
      }

      function buildRadarStatusData(targetId: number): StatusData[] {
        const byDay = new Map<
          string,
          { count: number; error: number; ok: number }
        >();

        for (const run of radarRunsByTargetId.get(targetId) ?? []) {
          const day = new Date(run.startedAt).toISOString().split("T")[0];
          const current = byDay.get(day) ?? { count: 0, error: 0, ok: 0 };
          current.count += 1;
          if (run.success) {
            current.ok += 1;
          } else {
            current.error += 1;
          }
          byDay.set(day, current);
        }

        return fillStatusDataFor45Days(
          Array.from(byDay.entries()).map(([day, value]) => ({
            day,
            count: value.count,
            ok: value.ok,
            degraded: 0,
            error: value.error,
            monitorId: `radar-${targetId}`,
          })),
          `radar-${targetId}`,
          lookbackPeriod,
        );
      }

      return pageComponents.map((c) => {
        const events = getEvents({
          maintenances: _page.maintenances,
          incidents: c.monitor?.incidents ?? [],
          reports: _page.statusReports,
          pageComponentId: c.id,
          monitorId: c.monitorId ?? undefined,
          componentType: c.type,
        });

        // Determine whether to use real Tinybird data or synthetic data
        const shouldUseRealData =
          c.type === "monitor" &&
          c.monitor &&
          input.barType !== "manual" &&
          process.env.NOOP_UPTIME !== "true";

        let filledData: StatusData[];
        const radarTargetId = radarTargetIdByComponentId.get(c.id);
        const isRadarComponent = radarTargetId !== undefined;
        if (isRadarComponent) {
          filledData = buildRadarStatusData(radarTargetId);
        } else if (shouldUseRealData) {
          // Monitor components with real data: use Tinybird data
          const monitorId = c.monitor?.id.toString() || "";
          const rawData = statusDataByMonitorId.get(monitorId) || [];
          filledData = fillStatusDataFor45Days(
            rawData,
            monitorId,
            lookbackPeriod,
          );
        } else {
          // Static components, manual mode, or NOOP mode do not have probe
          // samples. Keep the 45d grid empty so it renders as "no data"
          // instead of pretending every missing day is operational.
          filledData = fillStatusDataFor45Days(
            [],
            c.id.toString(),
            lookbackPeriod,
          );
        }

        const effectiveBarType = isRadarComponent
          ? "absolute"
          : c.type === "static"
            ? "manual"
            : input.barType;
        const effectiveCardType = isRadarComponent
          ? "requests"
          : c.type === "static"
            ? "manual"
            : input.cardType;

        const processedData = setDataByType({
          events,
          data: filledData,
          cardType: effectiveCardType,
          barType: effectiveBarType,
        });
        const hasSamples = filledData.some(
          (day) => day.ok + day.degraded + day.error > 0,
        );
        const uptime =
          isRadarComponent && !hasSamples
            ? "N/A"
            : getUptime({
                data: filledData,
                events,
                barType: effectiveBarType,
                cardType: effectiveCardType,
              });

        return {
          id: c.id,
          pageComponentId: c.id,
          name: c.name,
          description: c.description,
          type: c.type,
          // For monitor-type components, include monitor fields
          ...(c.monitor ? { monitor: c.monitor } : {}),
          data: processedData,
          uptime,
        };
      });
    }),

  // NOTE: used for the theme store
  getNoopUptime: publicProcedure.query(async () => {
    const data = fillStatusDataFor45DaysNoop({
      errorDays: [4],
      degradedDays: [40],
    });
    const processedData = setDataByType({
      events: [
        {
          type: "maintenance",
          from: new Date(new Date().setDate(new Date().getDate() - 10)),
          to: new Date(new Date().setDate(new Date().getDate() - 10)),
          name: "DB migration",
          id: 1,
          status: "info",
        },
      ],
      data,
      cardType: "requests",
      barType: "dominant",
    });
    return {
      data: processedData,
      uptime: "100%",
    };
  }),

  getReport: publicProcedure
    .input(z.object({ slug: z.string().toLowerCase(), id: z.number() }))
    .query(async (opts) => {
      if (!opts.input.slug) return null;

      const _page = await opts.ctx.db
        .select()
        .from(page)
        .where(
          sql`lower(${page.slug}) = ${opts.input.slug} OR lower(${page.customDomain}) = ${opts.input.slug}`,
        )
        .get();

      if (!_page) return null;

      const _report = await opts.ctx.db.query.statusReport.findFirst({
        where: and(
          eq(statusReport.id, opts.input.id),
          eq(statusReport.pageId, _page.id),
        ),
        with: {
          statusReportsToPageComponents: {
            with: { pageComponent: { with: { monitor: true } } },
          },
          statusReportUpdates: {
            orderBy: (reports, { desc }) => desc(reports.date),
            with: { statusReportUpdateToPageComponents: true },
          },
        },
      });

      if (!_report) return null;

      const result: z.infer<typeof selectStatusReportPageSchema> = _report;
      return selectStatusReportPageSchema.parse(result);
    }),

  getNoopReport: publicProcedure.query(async () => {
    const date = new Date(new Date().setDate(new Date().getDate() - 4));

    const resolvedDate = new Date(date.setMinutes(date.getMinutes() - 81));
    const monitoringDate = new Date(date.setMinutes(date.getMinutes() - 54));
    const identifiedDate = new Date(date.setMinutes(date.getMinutes() - 32));
    const investigatingDate = new Date(date.setMinutes(date.getMinutes() - 4));

    const props: z.input<typeof selectStatusReportPageSchema> = {
      id: 1,
      pageId: 1,
      workspaceId: 1,
      status: "investigating" as const,
      title: "API Latency Issues",
      createdAt: new Date(new Date().setDate(new Date().getDate() - 2)),
      updatedAt: new Date(new Date().setDate(new Date().getDate() - 1)),
      statusReportsToPageComponents: [
        {
          pageComponentId: 1,
          statusReportId: 1,
          pageComponent: {
            workspaceId: 1,
            pageId: 1,
            id: 1,
            name: "API Monitor",
            type: "monitor" as const,
            monitorId: 1,
            order: 1,
            groupId: null,
            groupOrder: null,
            description: "Main API endpoint",
            createdAt: new Date(new Date().setDate(new Date().getDate() - 30)),
            updatedAt: new Date(new Date().setDate(new Date().getDate() - 30)),
          },
        },
      ],
      statusReportUpdates: [
        {
          id: 4,
          statusReportId: 1,
          status: "resolved" as const,
          message:
            "All systems are operating normally. The issue has been fully resolved.",
          date: resolvedDate,
          createdAt: resolvedDate,
          updatedAt: resolvedDate,
        },
        {
          id: 3,
          statusReportId: 1,
          status: "monitoring" as const,
          message:
            "We are continuing to monitor the situation to ensure that the issue is resolved.",
          date: monitoringDate,
          createdAt: monitoringDate,
          updatedAt: monitoringDate,
        },
        {
          id: 2,
          statusReportId: 1,
          status: "identified" as const,
          message: "The issue has been identified and a fix is being deployed.",
          date: identifiedDate,
          createdAt: identifiedDate,
          updatedAt: identifiedDate,
        },
        {
          id: 1,
          statusReportId: 1,
          status: "investigating" as const,
          message:
            "We are investigating reports of increased latency on our API endpoints.",
          date: investigatingDate,
          createdAt: investigatingDate,
          updatedAt: investigatingDate,
        },
      ],
    };

    return selectStatusReportPageSchema.parse(props);
  }),

  getMonitors: publicProcedure
    .input(z.object({ slug: z.string().toLowerCase() }))
    .query(async (opts) => {
      if (!opts.input.slug) return null;

      // NOTE: revalidate the public monitors first
      const _page = await opts.ctx.db.query.page.findFirst({
        where: sql`lower(${page.slug}) = ${opts.input.slug} OR lower(${page.customDomain}) = ${opts.input.slug}`,
        with: {
          pageComponents: {
            with: {
              monitor: true,
            },
          },
        },
      });

      if (!_page) return null;

      const pageComponents = selectPageComponentWithMonitorRelation
        .array()
        .parse(_page.pageComponents);

      const publicMonitors = pageComponents
        .filter(isMonitorComponent)
        .filter((c) => c.monitor?.public);

      const monitorsByType = {
        http: publicMonitors.filter((c) => c.monitor.jobType === "http"),
        tcp: publicMonitors.filter((c) => c.monitor.jobType === "tcp"),
        dns: publicMonitors.filter((c) => c.monitor.jobType === "dns"),
      };

      const proceduresByType = {
        http: getMetricsLatencyMultiProcedure("1d", "http"),
        tcp: getMetricsLatencyMultiProcedure("1d", "tcp"),
        dns: getMetricsLatencyMultiProcedure("1d", "dns"),
      };

      const [
        metricsLatencyMultiHttp,
        metricsLatencyMultiTcp,
        metricsLatencyMultiDns,
      ] = await Promise.all(
        Object.entries(proceduresByType).map(([type, procedure]) => {
          const monitorIds = monitorsByType[
            type as keyof typeof proceduresByType
          ].map((c) => c.monitor.id.toString());
          if (monitorIds.length === 0) return null;
          return procedure({ monitorIds });
        }),
      );

      const metricsDataByMonitorId = new Map<
        string,
        | Awaited<ReturnType<(typeof proceduresByType)["http"]>>["data"]
        | Awaited<ReturnType<(typeof proceduresByType)["tcp"]>>["data"]
        | Awaited<ReturnType<(typeof proceduresByType)["dns"]>>["data"]
      >();

      if (metricsLatencyMultiHttp?.data) {
        metricsLatencyMultiHttp.data.forEach((metric) => {
          const monitorId = metric.monitorId;
          if (!metricsDataByMonitorId.has(monitorId)) {
            metricsDataByMonitorId.set(monitorId, []);
          }
          metricsDataByMonitorId.get(monitorId)?.push(metric);
        });
      }

      if (metricsLatencyMultiTcp?.data) {
        metricsLatencyMultiTcp.data.forEach((metric) => {
          const monitorId = metric.monitorId;
          if (!metricsDataByMonitorId.has(monitorId)) {
            metricsDataByMonitorId.set(monitorId, []);
          }
          metricsDataByMonitorId.get(monitorId)?.push(metric);
        });
      }

      if (metricsLatencyMultiDns?.data) {
        metricsLatencyMultiDns.data.forEach((metric) => {
          const monitorId = metric.monitorId;
          if (!metricsDataByMonitorId.has(monitorId)) {
            metricsDataByMonitorId.set(monitorId, []);
          }
          metricsDataByMonitorId.get(monitorId)?.push(metric);
        });
      }

      return publicMonitors.map((c) => {
        const monitorId = c.monitor.id.toString();
        const data = metricsDataByMonitorId.get(monitorId) || [];

        return {
          ...selectPublicMonitorSchema.parse(c.monitor),
          data,
        };
      });
    }),

  getMonitor: publicProcedure
    .input(z.object({ slug: z.string().toLowerCase(), id: z.number() }))
    .query(async (opts) => {
      if (!opts.input.slug) return null;

      const _page = await opts.ctx.db.query.page.findFirst({
        where: sql`lower(${page.slug}) = ${opts.input.slug} OR lower(${page.customDomain}) = ${opts.input.slug}`,
        with: {
          pageComponents: {
            where: eq(pageComponent.monitorId, opts.input.id),
            with: {
              monitor: true,
            },
          },
        },
      });

      if (!_page) return null;

      const pageComponents = selectPageComponentWithMonitorRelation
        .array()
        .parse(_page.pageComponents);

      const monitorComponents = pageComponents.filter(isMonitorComponent);

      const _monitor = monitorComponents.find(
        (c) => c.monitor.id === opts.input.id,
      )?.monitor;

      if (!_monitor) return null;
      if (!_monitor.public) return null;
      if (_monitor.deletedAt) return null;

      const type = _monitor.jobType as "http" | "tcp";

      const proceduresByType = {
        http: {
          latency: getMetricsLatencyProcedure("7d", "http"),
          regions: getMetricsRegionsProcedure("7d", "http"),
          uptime: getUptimeProcedure("7d", "http"),
        },
        tcp: {
          latency: getMetricsLatencyProcedure("7d", "tcp"),
          regions: getMetricsRegionsProcedure("7d", "tcp"),
          uptime: getUptimeProcedure("7d", "tcp"),
        },
        dns: {
          latency: getMetricsLatencyProcedure("7d", "dns"),
          regions: getMetricsRegionsProcedure("7d", "dns"),
          uptime: getUptimeProcedure("7d", "dns"),
        },
      };

      const fromDate = startOfDay(subDays(new Date(), 7)).toISOString();
      const toDate = endOfDay(new Date()).toISOString();

      const [latency, regions, uptime] = await Promise.all([
        proceduresByType[type].latency({
          monitorId: _monitor.id.toString(),
          fromDate,
          toDate,
        }),
        proceduresByType[type].regions({
          monitorId: _monitor.id.toString(),
          fromDate,
          toDate,
        }),
        proceduresByType[type].uptime({
          monitorId: _monitor.id.toString(),
          interval: 240,
          fromDate,
          toDate,
        }),
      ]);

      return {
        ...selectPublicMonitorSchema.parse(_monitor),
        data: {
          latency,
          regions,
          uptime,
        },
      };
    }),

  subscribe: publicProcedure
    .meta({ track: Events.SubscribePage, trackProps: ["slug"] })
    .input(
      z.union([
        z.object({
          channelType: z.literal("email").optional(),
          slug: z.string().toLowerCase(),
          email: z.email(),
          subscribeComponents: z.boolean(),
          pageComponents: z.array(z.number().int().positive()),
          locale: z.string().optional(),
        }),
        z.object({
          channelType: z.literal("webhook"),
          slug: z.string().toLowerCase(),
          webhookUrl: z.url(),
          subscribeComponents: z.boolean(),
          pageComponents: z.array(z.number().int().positive()),
          locale: z.string().optional(),
        }),
      ]),
    )
    .mutation(async (opts) => {
      if (!opts.input.slug) return null;

      const _page = await opts.ctx.db.query.page.findFirst({
        where: sql`lower(${page.slug}) = ${opts.input.slug} OR lower(${page.customDomain}) = ${opts.input.slug}`,
        with: {
          workspace: true,
        },
      });

      if (!_page) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Page not found",
        });
      }

      if (opts.input.channelType === "webhook") {
        const statusPageBaseUrl = getPublicStatusPageUrl({
          customDomain: _page.customDomain,
          slug: _page.slug,
          locale: _page.defaultLocale,
        });
        const subscription = await upsertSelfSignupSubscriber({
          input: {
            channelType: "webhook",
            webhookUrl: opts.input.webhookUrl,
            pageId: _page.id,
            locale: opts.input.locale ?? _page.defaultLocale,
            componentIds: opts.input.subscribeComponents
              ? opts.input.pageComponents
              : [],
          },
        });

        if (subscription.acceptedAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Webhook already subscribed",
          });
        }

        if (!subscription.token) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Subscription has no verification token",
          });
        }

        try {
          await sendWebhookVerification(
            {
              id: subscription.id,
              pageId: subscription.pageId,
              pageName: subscription.pageName,
              pageSlug: subscription.pageSlug,
              customDomain: subscription.customDomain,
              componentIds: subscription.componentIds,
              channelType: "webhook",
              webhookUrl: subscription.webhookUrl ?? opts.input.webhookUrl,
              token: subscription.token,
              acceptedAt: subscription.acceptedAt ?? undefined,
              locale: subscription.locale ?? _page.defaultLocale,
            },
            `${statusPageBaseUrl}/manage/${subscription.token}`,
          );

          const verified = await verifySelfSignupSubscriber({
            input: { token: subscription.token, domain: opts.input.slug },
          });

          return {
            id: subscription.id,
            token: subscription.token,
            channelType: "webhook" as const,
            acceptedAt: verified?.acceptedAt ?? null,
          };
        } catch (error) {
          await opts.ctx.db
            .delete(pageSubscriber)
            .where(
              and(
                eq(pageSubscriber.id, subscription.id),
                isNull(pageSubscriber.acceptedAt),
              ),
            )
            .run();

          if (error instanceof Error) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: error.message,
            });
          }
          throw error;
        }
      }

      const statusPageBaseUrl = getPublicStatusPageUrl({
        customDomain: _page.customDomain,
        slug: _page.slug,
        locale: opts.input.locale ?? _page.defaultLocale,
      });
      const subscription = await upsertSelfSignupSubscriber({
        input: {
          email: opts.input.email,
          pageId: _page.id,
          locale: opts.input.locale,
          componentIds: opts.input.subscribeComponents
            ? opts.input.pageComponents
            : [],
        },
      });

      // Already verified — no need to send another verification email
      if (subscription.acceptedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Email already subscribed",
        });
      }

      if (!subscription.token) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Subscription has no verification token",
        });
      }

      try {
        await sendEmailVerification(
          {
            id: subscription.id,
            pageId: subscription.pageId,
            pageName: subscription.pageName,
            pageSlug: subscription.pageSlug,
            customDomain: subscription.customDomain,
            componentIds: subscription.componentIds,
            channelType: "email",
            email: subscription.email ?? opts.input.email,
            token: subscription.token,
            acceptedAt: subscription.acceptedAt ?? undefined,
            locale: opts.input.locale,
          },
          `${statusPageBaseUrl}/verify/${subscription.token}`,
        );
      } catch (error) {
        await opts.ctx.db
          .delete(pageSubscriber)
          .where(
            and(
              eq(pageSubscriber.id, subscription.id),
              isNull(pageSubscriber.acceptedAt),
            ),
          )
          .run();

        if (error instanceof Error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          });
        }
        throw error;
      }

      return {
        id: subscription.id,
        token: subscription.token,
        channelType: "email" as const,
      };
    }),

  getSubscriptionByToken: publicProcedure
    .input(z.object({ slug: z.string().toLowerCase(), token: z.uuid() }))
    .query(async (opts) => {
      if (!opts.input.slug) return null;

      const subscription = await getSubscriberByToken({
        input: { token: opts.input.token, domain: opts.input.slug },
      });

      if (!subscription) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Subscription not found",
        });
      }

      return subscription;
    }),

  updateSubscription: publicProcedure
    .input(
      z.object({
        slug: z.string().toLowerCase(),
        token: z.uuid(),
        subscribeComponents: z.boolean(),
        pageComponents: z.array(z.number().int().positive()),
      }),
    )
    .mutation(async (opts) => {
      if (!opts.input.slug) return null;

      try {
        await updateSubscriberScope({
          input: {
            token: opts.input.token,
            componentIds: opts.input.subscribeComponents
              ? opts.input.pageComponents
              : [],
            domain: opts.input.slug,
          },
        });
      } catch (error) {
        if (error instanceof Error) {
          const code = error.message.toLowerCase().includes("not found")
            ? "NOT_FOUND"
            : "BAD_REQUEST";
          throw new TRPCError({ code, message: error.message });
        }
        throw error;
      }

      return { success: true };
    }),

  sendSubscriptionManagementLink: publicProcedure
    .input(
      z.object({
        slug: z.string().toLowerCase(),
        email: z.email(),
        locale: z.string().optional(),
      }),
    )
    .mutation(async (opts) => {
      if (!opts.input.slug) return { success: true };

      const _page = await opts.ctx.db.query.page.findFirst({
        where: sql`lower(${page.slug}) = ${opts.input.slug} OR lower(${page.customDomain}) = ${opts.input.slug}`,
      });

      if (!_page) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Page not found",
        });
      }

      const subscriber = await opts.ctx.db.query.pageSubscriber.findFirst({
        where: and(
          eq(pageSubscriber.pageId, _page.id),
          eq(pageSubscriber.channelType, "email"),
          eq(pageSubscriber.email, opts.input.email.toLowerCase()),
          isNull(pageSubscriber.unsubscribedAt),
        ),
      });

      if (!subscriber?.token || !subscriber.acceptedAt) {
        return { success: true };
      }

      const locale =
        opts.input.locale ?? subscriber.locale ?? _page.defaultLocale;
      const statusPageBaseUrl = getPublicStatusPageUrl({
        customDomain: _page.customDomain,
        slug: _page.slug,
        locale,
      });

      await emailClient.sendSubscriptionManagementLink({
        to: opts.input.email,
        page: _page.title,
        link: `${statusPageBaseUrl}/manage/${subscriber.token}`,
        locale,
      });

      return { success: true };
    }),

  validateEmailDomain: publicProcedure
    .meta({ track: Events.ValidateEmailDomain, trackProps: ["slug", "email"] })
    .input(z.object({ slug: z.string().toLowerCase(), email: z.string() }))
    .query(async (opts) => {
      if (!opts.input.slug) return null;

      const _page = await opts.ctx.db.query.page.findFirst({
        where: sql`lower(${page.slug}) = ${opts.input.slug} OR lower(${page.customDomain}) = ${opts.input.slug}`,
      });

      if (!_page) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Page not found",
        });
      }

      if (_page.accessType !== "email-domain") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Page is not configured to allow email domain authentication",
        });
      }

      const allowedDomains = _page.authEmailDomains?.split(",") ?? [];

      if (!allowedDomains.includes(opts.input.email.split("@")[1])) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid email domain",
        });
      }

      return {
        email: opts.input.email,
        slug: opts.input.slug,
        page: _page,
      };
    }),

  verifyEmail: publicProcedure
    .meta({ track: Events.VerifySubscribePage, trackProps: ["slug"] })
    .input(z.object({ slug: z.string().toLowerCase(), token: z.uuid() }))
    .mutation(async (opts) => {
      if (!opts.input.slug) return null;

      try {
        const subscription = await verifySelfSignupSubscriber({
          input: { token: opts.input.token, domain: opts.input.slug },
        });

        if (!subscription) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Subscription not found",
          });
        }

        return subscription;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        if (error instanceof Error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    }),

  verifyPassword: publicProcedure
    .input(z.object({ slug: z.string().toLowerCase(), password: z.string() }))
    .mutation(async (opts) => {
      if (!opts.input.slug) return null;

      const _page = await opts.ctx.db.query.page.findFirst({
        where: sql`lower(${page.slug}) = ${opts.input.slug} OR lower(${page.customDomain}) = ${opts.input.slug}`,
      });

      if (!_page) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Page not found",
        });
      }

      if (_page.accessType !== "password") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Page is not configured to allow password authentication",
        });
      }

      if (!constantTimeEqual(_page.password, opts.input.password)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid password",
        });
      }

      return true;
    }),

  // Server-side password gate for the public `/api/*` routes. Returns a boolean
  // so the stored password never leaves the server (the `get` output omits it).
  isPasswordAuthorized: publicProcedure
    .input(
      z.object({
        slug: z.string().toLowerCase(),
        queryPassword: z.string().nullish(),
        cookiePassword: z.string().nullish(),
      }),
    )
    .query(async (opts) => {
      const _page = await opts.ctx.db.query.page.findFirst({
        where: sql`lower(${page.slug}) = ${opts.input.slug} OR lower(${page.customDomain}) = ${opts.input.slug}`,
        columns: { password: true, accessType: true },
      });
      if (!_page || _page.accessType !== "password") return false;
      // TODO: rate-limit — an unauthenticated caller can brute-force guesses here.
      // Query param wins over cookie: a present-but-wrong `?pw=` must not fall
      // through to a valid cookie. Mirrors isPasswordAuthorized on the proxy.
      const submitted = opts.input.queryPassword ?? opts.input.cookiePassword;
      return constantTimeEqual(_page.password, submitted);
    }),

  getSubscriberByToken: publicProcedure
    .input(z.object({ token: z.uuid(), domain: z.string().toLowerCase() }))
    .query(async (opts) => {
      const subscription = await getSubscriberByToken({
        input: { token: opts.input.token, domain: opts.input.domain },
      });

      if (!subscription || subscription.unsubscribedAt) {
        return null;
      }

      return {
        pageName: subscription.pageName,
        maskedEmail: subscription.email ?? subscription.webhookUrl,
      };
    }),

  unsubscribe: publicProcedure
    .input(z.object({ token: z.uuid(), domain: z.string().toLowerCase() }))
    .mutation(async (opts) => {
      try {
        await unsubscribeSubscriber({
          input: { token: opts.input.token, domain: opts.input.domain },
        });
        return { success: true };
      } catch (error) {
        if (error instanceof Error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    }),
});
