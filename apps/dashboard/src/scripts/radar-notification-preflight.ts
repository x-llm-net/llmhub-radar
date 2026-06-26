import { radarNotificationEvent } from "@openstatus/db/src/schema";

import { defaultIntervalMs, loadLocalEnv } from "./script-env";

loadLocalEnv();

const { and, count, db, eq, gt, lt, max, min, or } = await import(
  "@openstatus/db"
);

const maxEventAgeMs = defaultIntervalMs(
  "RADAR_NOTIFICATION_MAX_EVENT_AGE_MS",
  15 * 60 * 1000,
);
const now = new Date();
const staleBefore = new Date(now.getTime() - maxEventAgeMs);

const [pending] = await db
  .select({
    count: count(),
    oldestCreatedAt: min(radarNotificationEvent.createdAt),
    newestCreatedAt: max(radarNotificationEvent.createdAt),
  })
  .from(radarNotificationEvent)
  .where(eq(radarNotificationEvent.status, "pending"))
  .all();

const [retryableFailed] = await db
  .select({
    count: count(),
    oldestCreatedAt: min(radarNotificationEvent.createdAt),
    newestCreatedAt: max(radarNotificationEvent.createdAt),
  })
  .from(radarNotificationEvent)
  .where(
    and(
      eq(radarNotificationEvent.status, "failed"),
      lt(radarNotificationEvent.attempts, 3),
    ),
  )
  .all();

const [freshDispatchable] = await db
  .select({ count: count() })
  .from(radarNotificationEvent)
  .where(
    and(
      gt(radarNotificationEvent.createdAt, staleBefore),
      or(
        eq(radarNotificationEvent.status, "pending"),
        and(
          eq(radarNotificationEvent.status, "failed"),
          lt(radarNotificationEvent.attempts, 3),
        ),
      ),
    ),
  )
  .all();

const [staleDispatchable] = await db
  .select({ count: count() })
  .from(radarNotificationEvent)
  .where(
    and(
      lt(radarNotificationEvent.createdAt, staleBefore),
      or(
        eq(radarNotificationEvent.status, "pending"),
        and(
          eq(radarNotificationEvent.status, "failed"),
          lt(radarNotificationEvent.attempts, 3),
        ),
      ),
    ),
  )
  .all();

console.log("[radar-notifications:preflight]", {
  now: now.toISOString(),
  maxEventAgeMs,
  staleBefore: staleBefore.toISOString(),
  pending: normalizeSummary(pending),
  retryableFailed: normalizeSummary(retryableFailed),
  freshDispatchable: freshDispatchable?.count ?? 0,
  staleDispatchable: staleDispatchable?.count ?? 0,
});

if ((staleDispatchable?.count ?? 0) > 0) {
  console.warn(
    "[radar-notifications:preflight] stale dispatchable events exist; worker default policy will ignore them. Review or mark them skipped before manual replay.",
  );
}

function normalizeSummary(input?: {
  count: number;
  oldestCreatedAt: Date | null;
  newestCreatedAt: Date | null;
}) {
  return {
    count: input?.count ?? 0,
    oldestCreatedAt: input?.oldestCreatedAt?.toISOString() ?? null,
    newestCreatedAt: input?.newestCreatedAt?.toISOString() ?? null,
  };
}
