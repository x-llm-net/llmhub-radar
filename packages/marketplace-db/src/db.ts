import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export function createMarketplaceDb(databaseUrl: string) {
  const sql = postgres(databaseUrl);
  const db = drizzle(sql, { schema });
  const client = {
    close: () => sql.end(),
  };

  return { client, db };
}

export type MarketplaceDb = ReturnType<typeof createMarketplaceDb>["db"];
