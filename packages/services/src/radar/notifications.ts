import { and, asc, count, db, eq, gt, lt, lte, or } from "@openstatus/db";
import {
  radarNotificationEvent,
  radarProbeTarget,
} from "@openstatus/db/src/schema";
import { dispatchPageUpdate, type PageUpdate } from "@openstatus/subscriptions";

import type { RadarNotificationEventType } from "./notification-policy";

const DEFAULT_LIMIT = 50;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_EVENT_AGE_MS = 15 * 60 * 1000;
const DEFAULT_REPLAY_GUARD_STARTED_AT = new Date();

export type DispatchRadarNotificationsResult = {
  selected: number;
  sent: number;
  failed: number;
  skipped: number;
  ignoredOlderThanCutoff: number;
  dispatchCutoff: Date | null;
};

export async function dispatchPendingRadarNotifications(input?: {
  limit?: number;
  maxAttempts?: number;
  maxEventAgeMs?: number;
  now?: Date;
  replayGuardStartedAt?: Date | null;
}): Promise<DispatchRadarNotificationsResult> {
  const limit = input?.limit ?? DEFAULT_LIMIT;
  const maxAttempts = input?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxEventAgeMs = input?.maxEventAgeMs ?? DEFAULT_MAX_EVENT_AGE_MS;
  const now = input?.now ?? new Date();
  const ageCutoff =
    maxEventAgeMs > 0 ? new Date(now.getTime() - maxEventAgeMs) : null;
  const replayGuardStartedAt =
    input?.replayGuardStartedAt === undefined
      ? DEFAULT_REPLAY_GUARD_STARTED_AT
      : input.replayGuardStartedAt;
  const dispatchCutoff = maxDate(ageCutoff, replayGuardStartedAt);
  const dispatchableCondition = getDispatchableCondition(maxAttempts);

  const [ignoredSummary] = dispatchCutoff
    ? await db
        .select({ count: count() })
        .from(radarNotificationEvent)
        .where(
          and(
            lte(radarNotificationEvent.createdAt, dispatchCutoff),
            dispatchableCondition,
          ),
        )
        .all()
    : [{ count: 0 }];

  const rows = await db
    .select({
      event: radarNotificationEvent,
      target: radarProbeTarget,
    })
    .from(radarNotificationEvent)
    .innerJoin(
      radarProbeTarget,
      eq(radarProbeTarget.id, radarNotificationEvent.targetId),
    )
    .where(
      and(
        dispatchCutoff
          ? gt(radarNotificationEvent.createdAt, dispatchCutoff)
          : undefined,
        dispatchableCondition,
      ),
    )
    .orderBy(
      asc(radarNotificationEvent.createdAt),
      asc(radarNotificationEvent.id),
    )
    .limit(limit)
    .all();

  const result: DispatchRadarNotificationsResult = {
    selected: rows.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    ignoredOlderThanCutoff: ignoredSummary?.count ?? 0,
    dispatchCutoff,
  };

  for (const row of rows) {
    if (!row.event.pageId) {
      await markEventSkipped(row.event.id, "No linked status page.");
      result.skipped += 1;
      continue;
    }

    try {
      await dispatchPageUpdate({
        id: row.event.id,
        pageId: row.event.pageId,
        title: row.event.title,
        status: toPageUpdateStatus(
          row.event.eventType as RadarNotificationEventType,
        ),
        message: row.event.message,
        pageComponentIds: [],
        pageComponents: [row.target.displayName],
        date: (row.event.createdAt ?? new Date()).toISOString(),
      });

      await db
        .update(radarNotificationEvent)
        .set({
          status: "sent",
          dispatchedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(radarNotificationEvent.id, row.event.id))
        .run();
      result.sent += 1;
    } catch (error) {
      await db
        .update(radarNotificationEvent)
        .set({
          status: "failed",
          attempts: row.event.attempts + 1,
          lastError: toSafeErrorMessage(error),
          updatedAt: new Date(),
        })
        .where(eq(radarNotificationEvent.id, row.event.id))
        .run();
      result.failed += 1;
    }
  }

  return result;
}

function getDispatchableCondition(maxAttempts: number) {
  return or(
    eq(radarNotificationEvent.status, "pending"),
    and(
      eq(radarNotificationEvent.status, "failed"),
      lt(radarNotificationEvent.attempts, maxAttempts),
    ),
  );
}

function maxDate(...dates: (Date | null)[]) {
  const validDates = dates.filter((date): date is Date => Boolean(date));
  if (validDates.length === 0) return null;

  return validDates.reduce((latest, date) =>
    date.getTime() > latest.getTime() ? date : latest,
  );
}

function toPageUpdateStatus(
  eventType: RadarNotificationEventType,
): PageUpdate["status"] {
  switch (eventType) {
    case "down":
      return "investigating";
    case "configuration_error":
      return "identified";
    case "degraded":
      return "monitoring";
    case "recovered":
      return "resolved";
  }
}

async function markEventSkipped(eventId: number, reason: string) {
  await db
    .update(radarNotificationEvent)
    .set({
      status: "skipped",
      lastError: reason,
      updatedAt: new Date(),
    })
    .where(eq(radarNotificationEvent.id, eventId))
    .run();
}

function toSafeErrorMessage(error: unknown) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown radar notification error";
  return raw.replace(/\s+/g, " ").slice(0, 500);
}
