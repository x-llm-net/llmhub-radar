import type { MarketplaceDb } from "./db";
import {
  hubApiTokens,
  hubBillingAuthorizations,
  hubLedgerAccounts,
  hubLedgerJournals,
  hubLedgerLines,
  hubRequestAttempts,
  hubRequests,
  hubTokenGroupPreferences,
  hubUsageRecords,
} from "./schema";

export async function clearHubRoutingAndBillingTestData(db: MarketplaceDb) {
  await db.delete(hubLedgerLines);
  await db.delete(hubUsageRecords);
  await db.delete(hubBillingAuthorizations);
  await db.delete(hubRequestAttempts);
  await db.delete(hubRequests);
  await db.delete(hubTokenGroupPreferences);
  await db.delete(hubApiTokens);
  await db.delete(hubLedgerJournals);
  await db.delete(hubLedgerAccounts);
}
