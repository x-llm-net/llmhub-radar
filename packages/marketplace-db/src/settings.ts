import { eq } from "drizzle-orm";

import type { MarketplaceDb } from "./db";
import { marketplaceSettings } from "./schema";
import { DEFAULT_MIN_RANKING_AVAILABILITY_BPS } from "./scoring";

const SETTINGS_ID = "default";

export async function getMarketplaceMinRankingAvailabilityBps(
  db: MarketplaceDb,
) {
  const [settings] = await db
    .select({
      minRankingAvailabilityBps: marketplaceSettings.minRankingAvailabilityBps,
    })
    .from(marketplaceSettings)
    .where(eq(marketplaceSettings.id, SETTINGS_ID))
    .limit(1);

  return (
    settings?.minRankingAvailabilityBps ?? DEFAULT_MIN_RANKING_AVAILABILITY_BPS
  );
}

export async function setMarketplaceMinRankingAvailabilityBps(
  db: MarketplaceDb,
  minRankingAvailabilityBps: number,
  updatedAt = new Date(),
) {
  await db
    .insert(marketplaceSettings)
    .values({
      id: SETTINGS_ID,
      minRankingAvailabilityBps,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: marketplaceSettings.id,
      set: { minRankingAvailabilityBps, updatedAt },
    });
}
