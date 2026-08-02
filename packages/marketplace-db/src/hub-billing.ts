import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  isNotNull,
  lte,
  notExists,
  or,
} from "drizzle-orm";

import type { MarketplaceDb } from "./db";
import {
  hubBillingAuthorizations,
  hubGroupPriceVersions,
  hubLedgerAccounts,
  hubLedgerJournals,
  hubLedgerLines,
  hubModelPriceComponents,
  hubModelPriceVersions,
  hubRequestAttempts,
  hubRequests,
  hubUsageRecords,
} from "./schema";

const MICROS_PER_MILLION_TOKENS = 1_000_000n;
const BPS = 10_000n;
export const HUB_PLATFORM_FEE_BPS = 1_000;

type MarketplaceTx = Parameters<Parameters<MarketplaceDb["transaction"]>[0]>[0];
type MarketplaceExecutor = MarketplaceDb | MarketplaceTx;

export type HubTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export type HubUsageCharge = {
  userAmountMicros: bigint;
  providerPayoutMicros: bigint;
  platformFeeMicros: bigint;
};

export type HubUsageSettlementPayload = {
  ownerId: string;
  tokenId: string;
  requestId: string;
  sourceSystem: string;
  sourceEventId: string;
  modelId: string;
  groupId: string;
  finalGroupModelId: string;
  usage: HubTokenUsage;
  externalRequestId?: string | null;
};

export type HubResolvedPricing = {
  modelPriceVersionId: string | null;
  groupPriceVersionId: string | null;
  multiplierBps: number;
  currency: string;
  components: Array<{
    component: string;
    unit: string;
    unitSize: number;
    amountMicros: bigint;
  }>;
};

export class HubBillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubBillingError";
  }
}

export class HubInsufficientBalanceError extends HubBillingError {
  readonly balanceMicros: bigint;
  readonly requiredMicros: bigint;

  constructor(balanceMicros: bigint, requiredMicros: bigint) {
    super("Insufficient account balance");
    this.name = "HubInsufficientBalanceError";
    this.balanceMicros = balanceMicros;
    this.requiredMicros = requiredMicros;
  }
}

export class HubPricingUnavailableError extends HubBillingError {
  constructor() {
    super("A current model price and group multiplier are required");
    this.name = "HubPricingUnavailableError";
  }
}

export async function quoteHubUsageAuthorization(
  db: MarketplaceExecutor,
  input: { modelId: string; groupIds: string[]; usage: HubTokenUsage },
) {
  let maximum = 0n;
  for (const groupId of new Set(input.groupIds)) {
    const pricing = await resolveHubPricing(db, {
      modelId: input.modelId,
      groupId,
    });
    if (!pricing) throw new HubPricingUnavailableError();
    const charge = calculateHubUsageCharge({
      usage: input.usage,
      multiplierBps: pricing.multiplierBps,
      components: pricing.components,
    });
    if (charge.userAmountMicros > maximum) {
      maximum = charge.userAmountMicros;
    }
  }
  if (input.groupIds.length === 0) throw new HubPricingUnavailableError();
  return maximum > 0n ? maximum : 1n;
}

export function calculateHubUsageCharge(input: {
  usage: HubTokenUsage;
  multiplierBps: number;
  components: HubResolvedPricing["components"];
  platformFeeBps?: number;
}): HubUsageCharge {
  const tokens: Record<string, bigint> = {
    input_text: BigInt(nonNegativeInteger(input.usage.inputTokens)),
    output_text: BigInt(nonNegativeInteger(input.usage.outputTokens)),
    cache_read: BigInt(nonNegativeInteger(input.usage.cacheReadTokens)),
    cache_write: BigInt(nonNegativeInteger(input.usage.cacheWriteTokens)),
  };
  let baseAmountMicros = 0n;
  for (const component of input.components) {
    const tokenCount = tokens[component.component] ?? 0n;
    if (tokenCount === 0n) continue;
    const denominator = BigInt(component.unitSize) * MICROS_PER_MILLION_TOKENS;
    baseAmountMicros += ceilDiv(
      tokenCount * component.amountMicros,
      denominator,
    );
  }

  const userAmountMicros = ceilDiv(
    baseAmountMicros * BigInt(Math.max(0, Math.floor(input.multiplierBps))),
    BPS,
  );
  const platformFeeMicros =
    (userAmountMicros * BigInt(input.platformFeeBps ?? HUB_PLATFORM_FEE_BPS)) /
    BPS;
  return {
    userAmountMicros,
    platformFeeMicros,
    providerPayoutMicros: userAmountMicros - platformFeeMicros,
  };
}

export async function resolveHubPricing(
  db: MarketplaceExecutor,
  input: { modelId: string; groupId: string; asOf?: Date },
): Promise<HubResolvedPricing | null> {
  const asOf = input.asOf ?? new Date();
  const [modelPrice] = await db
    .select({
      id: hubModelPriceVersions.id,
      currency: hubModelPriceVersions.currency,
    })
    .from(hubModelPriceVersions)
    .where(
      and(
        eq(hubModelPriceVersions.modelId, input.modelId),
        eq(hubModelPriceVersions.currency, "USD"),
        eq(hubModelPriceVersions.billingMode, "token"),
        lte(hubModelPriceVersions.effectiveFrom, asOf),
        or(
          isNull(hubModelPriceVersions.effectiveTo),
          gt(hubModelPriceVersions.effectiveTo, asOf),
        ),
      ),
    )
    .orderBy(desc(hubModelPriceVersions.effectiveFrom))
    .limit(1);
  const [groupPrice] = await db
    .select({
      id: hubGroupPriceVersions.id,
      multiplierBps: hubGroupPriceVersions.multiplierBps,
    })
    .from(hubGroupPriceVersions)
    .where(
      and(
        eq(hubGroupPriceVersions.groupId, input.groupId),
        lte(hubGroupPriceVersions.effectiveFrom, asOf),
        or(
          isNull(hubGroupPriceVersions.effectiveTo),
          gt(hubGroupPriceVersions.effectiveTo, asOf),
        ),
      ),
    )
    .orderBy(desc(hubGroupPriceVersions.effectiveFrom))
    .limit(1);

  if (!modelPrice || !groupPrice) return null;
  const components = await db
    .select({
      component: hubModelPriceComponents.component,
      unit: hubModelPriceComponents.unit,
      unitSize: hubModelPriceComponents.unitSize,
      amountMicros: hubModelPriceComponents.amountMicros,
    })
    .from(hubModelPriceComponents)
    .where(
      and(
        eq(hubModelPriceComponents.priceVersionId, modelPrice.id),
        eq(hubModelPriceComponents.unit, "million_tokens"),
      ),
    )
    .orderBy(asc(hubModelPriceComponents.component));
  const componentKinds = new Set(components.map((item) => item.component));
  if (!componentKinds.has("input_text") || !componentKinds.has("output_text")) {
    return null;
  }

  return {
    modelPriceVersionId: modelPrice.id,
    groupPriceVersionId: groupPrice.id,
    multiplierBps: groupPrice.multiplierBps,
    currency: modelPrice.currency,
    components: components.map((component) => ({
      ...component,
      amountMicros: BigInt(component.amountMicros),
    })),
  };
}

export async function getHubLedgerBalance(
  db: MarketplaceExecutor,
  input: { ownerId: string; currency?: string },
) {
  const currency = input.currency ?? "USD";
  const accountKey = userAccountKey(input.ownerId, currency);
  const [account] = await db
    .select({ id: hubLedgerAccounts.id })
    .from(hubLedgerAccounts)
    .where(
      and(
        eq(hubLedgerAccounts.accountKey, accountKey),
        eq(hubLedgerAccounts.currency, currency),
      ),
    )
    .limit(1);
  if (!account) return 0n;
  return getAccountBalance(db, account.id);
}

export async function postHubManualCredit(
  db: MarketplaceDb,
  input: {
    ownerId: string;
    amountMicros: bigint;
    currency?: string;
    idempotencyKey: string;
    actorId?: string;
    now?: Date;
  },
) {
  if (input.amountMicros <= 0n) {
    throw new HubBillingError("Credit amount must be positive");
  }
  const currency = input.currency ?? "USD";
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const accounts = await lockLedgerAccounts(tx, [
      userAccountSpec(input.ownerId, currency),
      adjustmentAccountSpec(currency),
    ]);
    const existing = await findJournalByIdempotency(tx, input.idempotencyKey);
    if (existing) return { journalId: existing.id, duplicate: true };
    if (!accounts.adjustment) {
      throw new Error("Adjustment ledger account was not created");
    }
    const [journal] = await tx
      .insert(hubLedgerJournals)
      .values({
        idempotencyKey: input.idempotencyKey,
        eventType: "manual_credit",
        currency,
        sourceType: "manual_credit",
        sourceId: input.ownerId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: hubLedgerJournals.id });
    if (!journal) throw new Error("Failed to create credit journal");
    await tx
      .insert(hubLedgerLines)
      .values([
        ledgerLine(
          journal.id,
          accounts.adjustment.id,
          1,
          "debit",
          input.amountMicros,
          now,
        ),
        ledgerLine(
          journal.id,
          accounts.user.id,
          2,
          "credit",
          input.amountMicros,
          now,
        ),
      ]);
    return { journalId: journal.id, duplicate: false };
  });
}

export async function authorizeHubUsage(
  db: MarketplaceDb,
  input: {
    ownerId: string;
    requestId: string;
    amountMicros: bigint;
    expiresAt?: Date;
    now?: Date;
  },
) {
  if (input.amountMicros <= 0n) {
    throw new HubBillingError("Authorization amount must be positive");
  }
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const accounts = await lockLedgerAccounts(tx, [
      userAccountSpec(input.ownerId, "USD"),
      adjustmentAccountSpec("USD"),
    ]);
    const [existing] = await tx
      .select()
      .from(hubBillingAuthorizations)
      .where(eq(hubBillingAuthorizations.requestId, input.requestId))
      .limit(1);
    if (existing) return { authorization: existing, duplicate: true };
    const balance = await getAccountBalance(tx, accounts.user.id);
    if (balance < input.amountMicros) {
      throw new HubInsufficientBalanceError(balance, input.amountMicros);
    }
    if (!accounts.adjustment) {
      throw new Error("Adjustment ledger account was not created");
    }
    const [journal] = await tx
      .insert(hubLedgerJournals)
      .values({
        idempotencyKey: `authorization:reserve:${input.requestId}`,
        eventType: "usage_authorization_reserved",
        currency: "USD",
        sourceType: "llmhub-authorization",
        sourceId: input.requestId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: hubLedgerJournals.id });
    if (!journal) throw new Error("Failed to create authorization journal");
    await tx
      .insert(hubLedgerLines)
      .values([
        ledgerLine(
          journal.id,
          accounts.user.id,
          1,
          "debit",
          input.amountMicros,
          now,
        ),
        ledgerLine(
          journal.id,
          accounts.adjustment.id,
          2,
          "credit",
          input.amountMicros,
          now,
        ),
      ]);
    const [authorization] = await tx
      .insert(hubBillingAuthorizations)
      .values({
        requestId: input.requestId,
        ownerUserId: input.ownerId,
        reservedAmountMicros: input.amountMicros,
        reservationJournalId: journal.id,
        expiresAt: input.expiresAt ?? new Date(now.getTime() + 30 * 60_000),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!authorization) throw new Error("Failed to create authorization");
    return { authorization, duplicate: false };
  });
}

export async function releaseHubUsageAuthorization(
  db: MarketplaceDb,
  input: {
    authorizationId: string;
    status?: "released" | "expired";
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [authorization] = await tx
      .select()
      .from(hubBillingAuthorizations)
      .where(eq(hubBillingAuthorizations.id, input.authorizationId))
      .limit(1)
      .for("update");
    if (!authorization) throw new HubBillingError("Authorization not found");
    if (authorization.status !== "reserved") {
      return { authorization, duplicate: true };
    }
    const accounts = await lockLedgerAccounts(tx, [
      userAccountSpec(authorization.ownerUserId, authorization.currency),
      adjustmentAccountSpec(authorization.currency),
    ]);
    if (!accounts.adjustment) {
      throw new Error("Adjustment ledger account was not created");
    }
    const [journal] = await tx
      .insert(hubLedgerJournals)
      .values({
        idempotencyKey: `authorization:${input.status ?? "released"}:${authorization.requestId}`,
        eventType: `usage_authorization_${input.status ?? "released"}`,
        currency: authorization.currency,
        sourceType: "llmhub-authorization",
        sourceId: authorization.requestId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: hubLedgerJournals.id });
    if (!journal) throw new Error("Failed to create authorization release");
    await tx
      .insert(hubLedgerLines)
      .values([
        ledgerLine(
          journal.id,
          accounts.adjustment.id,
          1,
          "debit",
          authorization.reservedAmountMicros,
          now,
        ),
        ledgerLine(
          journal.id,
          accounts.user.id,
          2,
          "credit",
          authorization.reservedAmountMicros,
          now,
        ),
      ]);
    const [updated] = await tx
      .update(hubBillingAuthorizations)
      .set({
        status: input.status ?? "released",
        settlementJournalId: journal.id,
        settledAt: now,
        updatedAt: now,
      })
      .where(eq(hubBillingAuthorizations.id, authorization.id))
      .returning();
    return { authorization: updated, duplicate: false };
  });
}

export async function releaseExpiredHubUsageAuthorizations(
  db: MarketplaceDb,
  input: { now?: Date; limit?: number } = {},
) {
  const now = input.now ?? new Date();
  const rows = await db
    .select({ id: hubBillingAuthorizations.id })
    .from(hubBillingAuthorizations)
    .innerJoin(
      hubRequests,
      eq(hubRequests.id, hubBillingAuthorizations.requestId),
    )
    .where(
      and(
        eq(hubBillingAuthorizations.status, "reserved"),
        lte(hubBillingAuthorizations.expiresAt, now),
        eq(hubRequests.status, "failed"),
        notExists(
          db
            .select({ id: hubRequestAttempts.id })
            .from(hubRequestAttempts)
            .where(
              and(
                eq(
                  hubRequestAttempts.requestId,
                  hubBillingAuthorizations.requestId,
                ),
                eq(hubRequestAttempts.outcome, "success"),
              ),
            ),
        ),
      ),
    )
    .limit(input.limit ?? 100);
  let released = 0;
  for (const row of rows) {
    const result = await releaseHubUsageAuthorization(db, {
      authorizationId: row.id,
      status: "expired",
      now,
    });
    if (!result.duplicate) released += 1;
  }
  return { released };
}

export async function stageHubUsageSettlement(
  db: MarketplaceDb,
  input: {
    authorizationId: string;
    payload: HubUsageSettlementPayload;
    attempt: {
      attemptNo: number;
      groupModelId: string;
      relayChannelBindingId?: string | null;
      externalChannelId?: string | null;
      configVersion: number;
      upstreamRequestId?: string | null;
      startedAt: Date;
      completedAt: Date;
    };
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [authorization] = await tx
      .select()
      .from(hubBillingAuthorizations)
      .where(eq(hubBillingAuthorizations.id, input.authorizationId))
      .limit(1)
      .for("update");
    if (!authorization) throw new HubBillingError("Authorization not found");
    if (authorization.status === "captured") {
      return { authorization, duplicate: true };
    }
    if (authorization.status !== "reserved") {
      throw new HubBillingError("Usage authorization is not reserved");
    }
    if (authorization.settlementPayload) {
      return { authorization, duplicate: true };
    }
    if (
      authorization.requestId !== input.payload.requestId ||
      authorization.ownerUserId !== input.payload.ownerId
    ) {
      throw new HubBillingError("Settlement does not match authorization");
    }
    await tx.insert(hubRequestAttempts).values({
      requestId: input.payload.requestId,
      attemptNo: input.attempt.attemptNo,
      groupModelId: input.attempt.groupModelId,
      relayChannelBindingId: input.attempt.relayChannelBindingId ?? null,
      externalChannelId: input.attempt.externalChannelId ?? null,
      configVersion: input.attempt.configVersion,
      outcome: "success",
      upstreamRequestId: input.attempt.upstreamRequestId ?? null,
      startedAt: input.attempt.startedAt,
      completedAt: input.attempt.completedAt,
      createdAt: now,
      updatedAt: now,
    });
    const [updated] = await tx
      .update(hubBillingAuthorizations)
      .set({ settlementPayload: input.payload, updatedAt: now })
      .where(eq(hubBillingAuthorizations.id, authorization.id))
      .returning();
    if (!updated) throw new Error("Failed to stage usage settlement");
    return { authorization: updated, duplicate: false };
  });
}

export async function capturePendingHubUsageSettlements(
  db: MarketplaceDb,
  input: { before?: Date; limit?: number } = {},
) {
  const before = input.before ?? new Date();
  const rows = await db
    .select({
      id: hubBillingAuthorizations.id,
      payload: hubBillingAuthorizations.settlementPayload,
    })
    .from(hubBillingAuthorizations)
    .where(
      and(
        eq(hubBillingAuthorizations.status, "reserved"),
        isNotNull(hubBillingAuthorizations.settlementPayload),
        lte(hubBillingAuthorizations.updatedAt, before),
      ),
    )
    .orderBy(asc(hubBillingAuthorizations.updatedAt))
    .limit(input.limit ?? 100);
  let captured = 0;
  let failed = 0;
  for (const row of rows) {
    if (!row.payload) continue;
    try {
      const result = await postHubUsageCharge(db, {
        ...row.payload,
        authorizationId: row.id,
      });
      if (!result.duplicate) captured += 1;
    } catch {
      failed += 1;
      await db
        .update(hubBillingAuthorizations)
        .set({
          updatedAt: new Date(Math.max(Date.now(), before.getTime() + 1)),
        })
        .where(eq(hubBillingAuthorizations.id, row.id));
    }
  }
  return { captured, failed, processed: rows.length };
}

export async function postHubUsageCharge(
  db: MarketplaceDb,
  input: {
    ownerId: string;
    tokenId: string;
    requestId: string;
    sourceSystem: string;
    sourceEventId: string;
    modelId: string;
    groupId: string;
    finalGroupModelId: string;
    usage: HubTokenUsage;
    authorizationId?: string;
    externalRequestId?: string | null;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(hubUsageRecords)
      .where(
        or(
          eq(hubUsageRecords.requestId, input.requestId),
          and(
            eq(hubUsageRecords.sourceSystem, input.sourceSystem),
            eq(hubUsageRecords.sourceEventId, input.sourceEventId),
          ),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return { usage: existing[0], duplicate: true };
    }

    const [billingRequest] = await tx
      .select({
        ownerUserId: hubRequests.ownerUserId,
        tokenId: hubRequests.tokenId,
        canonicalModelId: hubRequests.canonicalModelId,
        createdAt: hubRequests.createdAt,
      })
      .from(hubRequests)
      .where(eq(hubRequests.id, input.requestId))
      .limit(1);
    if (
      !billingRequest ||
      billingRequest.ownerUserId !== input.ownerId ||
      billingRequest.tokenId !== input.tokenId ||
      billingRequest.canonicalModelId !== input.modelId
    ) {
      throw new HubBillingError("Usage does not match request");
    }

    const authorization = input.authorizationId
      ? await tx
          .select()
          .from(hubBillingAuthorizations)
          .where(
            and(
              eq(hubBillingAuthorizations.id, input.authorizationId),
              eq(hubBillingAuthorizations.requestId, input.requestId),
              eq(hubBillingAuthorizations.ownerUserId, input.ownerId),
            ),
          )
          .limit(1)
          .for("update")
          .then((rows) => rows[0] ?? null)
      : null;
    if (input.authorizationId && !authorization) {
      throw new HubBillingError("Usage authorization not found");
    }
    if (authorization && authorization.status !== "reserved") {
      if (authorization?.status === "captured") {
        const [settledUsage] = await tx
          .select()
          .from(hubUsageRecords)
          .where(eq(hubUsageRecords.requestId, input.requestId))
          .limit(1);
        if (settledUsage) return { usage: settledUsage, duplicate: true };
      }
      throw new HubBillingError("Usage authorization is not reserved");
    }
    const pricing = await resolveHubPricing(tx, {
      modelId: input.modelId,
      groupId: input.groupId,
      asOf: authorization?.createdAt ?? billingRequest.createdAt,
    });
    if (!pricing) throw new HubPricingUnavailableError();
    const charge = calculateHubUsageCharge({
      usage: input.usage,
      multiplierBps: pricing.multiplierBps,
      components: pricing.components,
    });

    const accounts = await lockLedgerAccounts(tx, [
      userAccountSpec(input.ownerId, pricing.currency),
      providerAccountSpec(input.groupId, pricing.currency),
      platformAccountSpec(pricing.currency),
      ...(authorization ? [adjustmentAccountSpec(pricing.currency)] : []),
    ]);
    if (!accounts.provider || !accounts.platform) {
      throw new Error("Usage ledger accounts were not created");
    }
    const existingAfterLock = await tx
      .select()
      .from(hubUsageRecords)
      .where(
        or(
          eq(hubUsageRecords.requestId, input.requestId),
          and(
            eq(hubUsageRecords.sourceSystem, input.sourceSystem),
            eq(hubUsageRecords.sourceEventId, input.sourceEventId),
          ),
        ),
      )
      .limit(1);
    if (existingAfterLock[0]) {
      return { usage: existingAfterLock[0], duplicate: true };
    }
    const balance = await getAccountBalance(tx, accounts.user.id);
    if (!authorization && balance < charge.userAmountMicros) {
      throw new HubInsufficientBalanceError(balance, charge.userAmountMicros);
    }

    const additionalAmount = authorization
      ? charge.userAmountMicros - authorization.reservedAmountMicros
      : charge.userAmountMicros;
    if (additionalAmount > 0n && balance < additionalAmount) {
      throw new HubInsufficientBalanceError(balance, additionalAmount);
    }

    let journalId: string | null = null;
    if (charge.userAmountMicros > 0n || authorization) {
      const idempotencyKey = `usage:${input.sourceSystem}:${input.sourceEventId}`;
      const [journal] = await tx
        .insert(hubLedgerJournals)
        .values({
          idempotencyKey,
          eventType: "usage_charge",
          currency: pricing.currency,
          sourceType: input.sourceSystem,
          sourceId: input.sourceEventId,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: hubLedgerJournals.id });
      if (!journal) throw new Error("Failed to create usage journal");
      journalId = journal.id;
      const lines = [];
      let lineNo = 1;
      if (authorization) {
        if (!accounts.adjustment) {
          throw new Error("Adjustment ledger account was not created");
        }
        lines.push(
          ledgerLine(
            journal.id,
            accounts.adjustment.id,
            lineNo++,
            "debit",
            authorization.reservedAmountMicros,
            now,
          ),
        );
        const difference =
          charge.userAmountMicros - authorization.reservedAmountMicros;
        if (difference > 0n) {
          lines.push(
            ledgerLine(
              journal.id,
              accounts.user.id,
              lineNo++,
              "debit",
              difference,
              now,
            ),
          );
        } else if (difference < 0n) {
          lines.push(
            ledgerLine(
              journal.id,
              accounts.user.id,
              lineNo++,
              "credit",
              -difference,
              now,
            ),
          );
        }
      } else {
        lines.push(
          ledgerLine(
            journal.id,
            accounts.user.id,
            lineNo++,
            "debit",
            charge.userAmountMicros,
            now,
          ),
        );
      }
      if (charge.providerPayoutMicros > 0n) {
        lines.push(
          ledgerLine(
            journal.id,
            accounts.provider.id,
            lineNo++,
            "credit",
            charge.providerPayoutMicros,
            now,
          ),
        );
      }
      if (charge.platformFeeMicros > 0n) {
        lines.push(
          ledgerLine(
            journal.id,
            accounts.platform.id,
            lineNo++,
            "credit",
            charge.platformFeeMicros,
            now,
          ),
        );
      }
      await tx.insert(hubLedgerLines).values(lines);
    }

    const [usage] = await tx
      .insert(hubUsageRecords)
      .values({
        requestId: input.requestId,
        sourceSystem: input.sourceSystem,
        sourceEventId: input.sourceEventId,
        tokenId: input.tokenId,
        finalGroupModelId: input.finalGroupModelId,
        modelPriceVersionId: pricing.modelPriceVersionId,
        groupPriceVersionId: pricing.groupPriceVersionId,
        inputTokens: nonNegativeInteger(input.usage.inputTokens),
        outputTokens: nonNegativeInteger(input.usage.outputTokens),
        cacheReadTokens: nonNegativeInteger(input.usage.cacheReadTokens),
        cacheWriteTokens: nonNegativeInteger(input.usage.cacheWriteTokens),
        pricingSnapshot: {
          currency: pricing.currency,
          multiplierBps: pricing.multiplierBps,
          platformFeeBps: HUB_PLATFORM_FEE_BPS,
          components: pricing.components.map((component) => ({
            ...component,
            amountMicros: component.amountMicros.toString(),
          })),
        },
        userAmountMicros: charge.userAmountMicros,
        providerPayoutMicros: charge.providerPayoutMicros,
        platformFeeMicros: charge.platformFeeMicros,
        currency: pricing.currency,
        ledgerJournalId: journalId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!usage) throw new Error("Failed to create usage record");
    if (authorization) {
      await tx
        .update(hubBillingAuthorizations)
        .set({
          status: "captured",
          capturedAmountMicros: charge.userAmountMicros,
          settlementJournalId: journalId,
          settledAt: now,
          updatedAt: now,
        })
        .where(eq(hubBillingAuthorizations.id, authorization.id));
    }
    const [completedRequest] = await tx
      .update(hubRequests)
      .set({
        status: "succeeded",
        finalGroupModelId: input.finalGroupModelId,
        externalRequestId: input.externalRequestId ?? null,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(hubRequests.id, input.requestId))
      .returning({ id: hubRequests.id });
    if (!completedRequest) throw new Error("Failed to complete billed request");
    return { usage, duplicate: false };
  });
}

async function getAccountBalance(db: MarketplaceExecutor, accountId: string) {
  const lines = await db
    .select({
      direction: hubLedgerLines.direction,
      amountMicros: hubLedgerLines.amountMicros,
    })
    .from(hubLedgerLines)
    .where(eq(hubLedgerLines.accountId, accountId));
  return lines.reduce(
    (balance, line) =>
      balance +
      (line.direction === "credit" ? line.amountMicros : -line.amountMicros),
    0n,
  );
}

async function lockLedgerAccounts(
  db: MarketplaceTx,
  specs: Array<{
    key: string;
    type:
      | "user_credit"
      | "provider_payable"
      | "platform_revenue"
      | "adjustment";
    ownerId?: string;
    currency: string;
  }>,
) {
  await db
    .insert(hubLedgerAccounts)
    .values(
      specs.map((spec) => ({
        accountKey: spec.key,
        accountType: spec.type,
        ownerId: spec.ownerId ?? null,
        currency: spec.currency,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    )
    .onConflictDoNothing({ target: hubLedgerAccounts.accountKey });
  const rows = await db
    .select()
    .from(hubLedgerAccounts)
    .where(
      inArray(
        hubLedgerAccounts.accountKey,
        specs.map((spec) => spec.key),
      ),
    )
    .orderBy(asc(hubLedgerAccounts.accountKey))
    .for("update");
  const byKey = new Map(rows.map((row) => [row.accountKey, row]));
  const result = {
    user: byKey.get(
      specs.find((spec) => spec.type === "user_credit")?.key ?? "",
    ),
    provider: byKey.get(
      specs.find((spec) => spec.type === "provider_payable")?.key ?? "",
    ),
    platform: byKey.get(
      specs.find((spec) => spec.type === "platform_revenue")?.key ?? "",
    ),
    adjustment: byKey.get(
      specs.find((spec) => spec.type === "adjustment")?.key ?? "",
    ),
  };
  if (!result.user) throw new Error("User ledger account was not created");
  if (
    specs.some((spec) => spec.type === "provider_payable") &&
    !result.provider
  ) {
    throw new Error("Provider ledger account was not created");
  }
  if (
    specs.some((spec) => spec.type === "platform_revenue") &&
    !result.platform
  ) {
    throw new Error("Platform ledger account was not created");
  }
  if (specs.some((spec) => spec.type === "adjustment") && !result.adjustment) {
    throw new Error("Adjustment ledger account was not created");
  }
  return result as {
    user: (typeof rows)[number];
    provider: (typeof rows)[number] | undefined;
    platform: (typeof rows)[number] | undefined;
    adjustment: (typeof rows)[number] | undefined;
  };
}

async function findJournalByIdempotency(db: MarketplaceExecutor, key: string) {
  const [journal] = await db
    .select({ id: hubLedgerJournals.id })
    .from(hubLedgerJournals)
    .where(eq(hubLedgerJournals.idempotencyKey, key))
    .limit(1);
  return journal ?? null;
}

function ledgerLine(
  journalId: string,
  accountId: string,
  lineNo: number,
  direction: "debit" | "credit",
  amountMicros: bigint,
  now: Date,
) {
  return {
    journalId,
    accountId,
    lineNo,
    direction,
    amountMicros,
    createdAt: now,
    updatedAt: now,
  } as const;
}

function userAccountKey(ownerId: string, currency: string) {
  return `user:${ownerId}:credit:${currency}`;
}

function userAccountSpec(ownerId: string, currency: string) {
  return {
    key: userAccountKey(ownerId, currency),
    type: "user_credit" as const,
    ownerId,
    currency,
  };
}

function providerAccountSpec(groupId: string, currency: string) {
  return {
    key: `provider:${groupId}:payable:${currency}`,
    type: "provider_payable" as const,
    ownerId: groupId,
    currency,
  };
}

function platformAccountSpec(currency: string) {
  return {
    key: `platform:revenue:${currency}`,
    type: "platform_revenue" as const,
    currency,
  };
}

function adjustmentAccountSpec(currency: string) {
  return {
    key: `platform:adjustment:${currency}`,
    type: "adjustment" as const,
    currency,
  };
}

function ceilDiv(value: bigint, denominator: bigint) {
  if (value <= 0n) return 0n;
  return (value + denominator - 1n) / denominator;
}

function nonNegativeInteger(value: number | undefined) {
  if (!Number.isFinite(value) || !value || value < 0) return 0;
  return Math.floor(value);
}
