import { and, count, eq, inArray, isNull, like, or, sql } from "@openstatus/db";
import {
  radarAccount,
  radarClaimApplication,
  radarPool,
  user,
  usersToWorkspaces,
} from "@openstatus/db/src/schema";

import {
  type DB,
  type ServiceContext,
  getReadDb,
  tryGetActorUserId,
} from "../context";
import { ForbiddenError, LimitExceededError, NotFoundError } from "../errors";
import type { ListRadarOwnerCandidatesInput } from "./schemas";

export const STANDARD_PROVIDER_LIMIT = 1;
export const VERIFIED_PROVIDER_LIMIT = 3;

export type RadarVerificationStatus =
  | "unverified"
  | "pending"
  | "verified"
  | "rejected";

export type RadarActorAccess = {
  userId: number;
  email: string;
  name: string | null;
  isAdmin: boolean;
  verificationStatus: RadarVerificationStatus;
  providerLimit: number | null;
  ownedCount: number;
  pendingClaimCount: number;
  providerUsage: number;
  canCreate: boolean;
};

export type RadarOwnerCandidate = {
  userId: number;
  workspaceId: number;
  email: string;
  name: string | null;
  verificationStatus: RadarVerificationStatus;
  providerLimit: number | null;
  ownedCount: number;
  pendingClaimCount: number;
  providerUsage: number;
};

type RadarAccessEnvironment = {
  RADAR_ADMIN_EMAILS?: string;
};

export function parseRadarAdminEmails(value?: string): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function getRadarProviderLimit(
  verificationStatus: RadarVerificationStatus,
): number {
  return verificationStatus === "verified"
    ? VERIFIED_PROVIDER_LIMIT
    : STANDARD_PROVIDER_LIMIT;
}

function getAdminEmails(env?: RadarAccessEnvironment) {
  return parseRadarAdminEmails(
    env?.RADAR_ADMIN_EMAILS ?? process.env.RADAR_ADMIN_EMAILS,
  );
}

async function readRadarUserAccess(args: {
  db: DB;
  userId: number;
  adminEmails?: Set<string>;
}) {
  const row = await args.db
    .select({
      userId: user.id,
      email: user.email,
      name: user.name,
      verificationStatus: radarAccount.verificationStatus,
    })
    .from(user)
    .leftJoin(radarAccount, eq(radarAccount.userId, user.id))
    .where(eq(user.id, args.userId))
    .get();

  if (!row) throw new NotFoundError("user", args.userId);

  const email = row.email?.trim().toLowerCase() ?? "";
  const verificationStatus =
    (row.verificationStatus as RadarVerificationStatus | null) ?? "unverified";
  const isAdmin = (args.adminEmails ?? getAdminEmails()).has(email);

  return {
    userId: row.userId,
    email,
    name: row.name,
    verificationStatus,
    isAdmin,
    providerLimit: isAdmin ? null : getRadarProviderLimit(verificationStatus),
  };
}

async function countOwnedPools(db: DB, userId: number) {
  const row = await db
    .select({ count: count() })
    .from(radarPool)
    .where(and(eq(radarPool.ownerUserId, userId), isNull(radarPool.deletedAt)))
    .get();
  return row?.count ?? 0;
}

async function countPendingClaims(db: DB, userId: number) {
  const row = await db
    .select({ count: count() })
    .from(radarClaimApplication)
    .where(
      and(
        eq(radarClaimApplication.applicantUserId, userId),
        eq(radarClaimApplication.status, "pending"),
      ),
    )
    .get();
  return row?.count ?? 0;
}

async function getRadarProviderUsage(db: DB, userId: number) {
  const [ownedCount, pendingClaimCount] = await Promise.all([
    countOwnedPools(db, userId),
    countPendingClaims(db, userId),
  ]);
  return {
    ownedCount,
    pendingClaimCount,
    providerUsage: ownedCount + pendingClaimCount,
  };
}

export async function getRadarActorAccess(args: {
  ctx: ServiceContext;
  db?: DB;
  adminEmails?: Set<string>;
}): Promise<RadarActorAccess> {
  const db = args.db ?? getReadDb(args.ctx);
  const userId = tryGetActorUserId(args.ctx.actor);
  if (userId == null) {
    throw new ForbiddenError("Radar provider management requires a user.");
  }

  const [access, usage] = await Promise.all([
    readRadarUserAccess({
      db,
      userId,
      adminEmails: args.adminEmails,
    }),
    getRadarProviderUsage(db, userId),
  ]);

  return {
    ...access,
    ...usage,
    canCreate:
      access.providerLimit == null ||
      usage.providerUsage < access.providerLimit,
  };
}

async function getPrimaryWorkspaceId(db: DB, userId: number) {
  const ownerWorkspace = await db
    .select({ workspaceId: usersToWorkspaces.workspaceId })
    .from(usersToWorkspaces)
    .where(
      and(
        eq(usersToWorkspaces.userId, userId),
        eq(usersToWorkspaces.role, "owner"),
      ),
    )
    .orderBy(usersToWorkspaces.createdAt)
    .get();

  if (ownerWorkspace) return ownerWorkspace.workspaceId;

  const firstWorkspace = await db
    .select({ workspaceId: usersToWorkspaces.workspaceId })
    .from(usersToWorkspaces)
    .where(eq(usersToWorkspaces.userId, userId))
    .orderBy(usersToWorkspaces.createdAt)
    .get();

  if (!firstWorkspace) {
    throw new ForbiddenError("The selected owner has no workspace.");
  }
  return firstWorkspace.workspaceId;
}

export async function resolveRadarCreationOwner(args: {
  ctx: ServiceContext;
  db: DB;
  requestedOwnerUserId?: number;
}) {
  const actorAccess = await getRadarActorAccess({
    ctx: args.ctx,
    db: args.db,
  });
  const requestedOwnerUserId = args.requestedOwnerUserId;

  if (
    requestedOwnerUserId != null &&
    requestedOwnerUserId !== actorAccess.userId &&
    !actorAccess.isAdmin
  ) {
    throw new ForbiddenError("Only administrators can assign an owner.");
  }

  const ownerUserId = requestedOwnerUserId ?? actorAccess.userId;
  const ownerAccess =
    ownerUserId === actorAccess.userId
      ? actorAccess
      : await readRadarUserAccess({
          db: args.db,
          userId: ownerUserId,
        });

  const workspaceId =
    ownerUserId === actorAccess.userId
      ? args.ctx.workspace.id
      : await getPrimaryWorkspaceId(args.db, ownerUserId);

  if (!ownerAccess.isAdmin) {
    await args.db
      .insert(radarAccount)
      .values({ userId: ownerUserId })
      .onConflictDoNothing();

    await args.db
      .update(radarAccount)
      .set({ updatedAt: new Date() })
      .where(eq(radarAccount.userId, ownerUserId));

    const usage =
      ownerUserId === actorAccess.userId
        ? actorAccess
        : await getRadarProviderUsage(args.db, ownerUserId);
    const providerLimit =
      ownerAccess.providerLimit ??
      getRadarProviderLimit(ownerAccess.verificationStatus);

    if (usage.providerUsage >= providerLimit) {
      throw new LimitExceededError("provider ownership", providerLimit);
    }
  }

  return {
    ownerUserId,
    workspaceId,
    claimable: actorAccess.isAdmin && requestedOwnerUserId == null,
    actorAccess,
  };
}

export async function listRadarOwnerCandidates(args: {
  ctx: ServiceContext;
  db?: DB;
  input?: ListRadarOwnerCandidatesInput;
}): Promise<RadarOwnerCandidate[]> {
  const db = args.db ?? getReadDb(args.ctx);
  const input = args.input ?? { query: "", limit: 20 };
  const actorAccess = await getRadarActorAccess({ ctx: args.ctx, db });
  if (!actorAccess.isAdmin) {
    throw new ForbiddenError("Only administrators can list provider owners.");
  }

  const query = input.query.trim();
  const candidateIds = new Set<number>();
  if (input.selectedUserId != null) {
    candidateIds.add(input.selectedUserId);
  }

  if (query.length >= 2) {
    const pattern = `%${query}%`;
    const matchingUsers = await db
      .select({ userId: user.id })
      .from(user)
      .where(or(like(user.email, pattern), like(user.name, pattern)))
      .orderBy(user.email)
      .limit(input.limit)
      .all();
    for (const matchingUser of matchingUsers) {
      candidateIds.add(matchingUser.userId);
    }
  }

  if (candidateIds.size === 0) return [];

  const rows = await db
    .select({
      userId: user.id,
      email: user.email,
      name: user.name,
      workspaceId: usersToWorkspaces.workspaceId,
      role: usersToWorkspaces.role,
      verificationStatus: radarAccount.verificationStatus,
    })
    .from(user)
    .innerJoin(usersToWorkspaces, eq(usersToWorkspaces.userId, user.id))
    .leftJoin(radarAccount, eq(radarAccount.userId, user.id))
    .where(inArray(user.id, Array.from(candidateIds)))
    .orderBy(user.email, usersToWorkspaces.createdAt)
    .all();

  const candidates = new Map<
    number,
    Omit<
      RadarOwnerCandidate,
      "ownedCount" | "pendingClaimCount" | "providerUsage"
    >
  >();
  const adminEmails = getAdminEmails();

  for (const row of rows) {
    const current = candidates.get(row.userId);
    if (current && row.role !== "owner") continue;

    const verificationStatus =
      (row.verificationStatus as RadarVerificationStatus | null) ??
      "unverified";
    const email = row.email?.trim().toLowerCase() ?? "";
    candidates.set(row.userId, {
      userId: row.userId,
      workspaceId: row.workspaceId,
      email,
      name: row.name,
      verificationStatus,
      providerLimit: adminEmails.has(email)
        ? null
        : getRadarProviderLimit(verificationStatus),
    });
  }

  const userIds = Array.from(candidates.keys());
  const [ownedRows, pendingRows] = await Promise.all([
    userIds.length === 0
      ? []
      : db
          .select({
            userId: radarPool.ownerUserId,
            count: sql<number>`count(*)`,
          })
          .from(radarPool)
          .where(inArray(radarPool.ownerUserId, userIds))
          .groupBy(radarPool.ownerUserId)
          .all(),
    userIds.length === 0
      ? []
      : db
          .select({
            userId: radarClaimApplication.applicantUserId,
            count: sql<number>`count(*)`,
          })
          .from(radarClaimApplication)
          .where(
            and(
              inArray(radarClaimApplication.applicantUserId, userIds),
              eq(radarClaimApplication.status, "pending"),
            ),
          )
          .groupBy(radarClaimApplication.applicantUserId)
          .all(),
  ]);
  const ownedByUser = new Map(
    ownedRows
      .filter(
        (row): row is { userId: number; count: number } => row.userId != null,
      )
      .map((row) => [row.userId, row.count]),
  );
  const pendingByUser = new Map(
    pendingRows.map((row) => [row.userId, row.count]),
  );

  return Array.from(candidates.values()).map((candidate) => {
    const ownedCount = ownedByUser.get(candidate.userId) ?? 0;
    const pendingClaimCount = pendingByUser.get(candidate.userId) ?? 0;
    return {
      ...candidate,
      ownedCount,
      pendingClaimCount,
      providerUsage: ownedCount + pendingClaimCount,
    };
  });
}
