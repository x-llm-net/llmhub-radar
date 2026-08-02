import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";

import {
  hubGroupBlocks,
  hubGroupModels,
  hubGroupPriceVersions,
  hubGroupSecrets,
  hubModelAliases,
  hubModelPriceComponents,
  hubModelPriceVersions,
  hubModels,
  hubProviderGroups,
  hubProviders,
  models,
  providers,
} from "./schema";

const stageATables = [
  hubProviders,
  hubProviderGroups,
  hubGroupBlocks,
  hubGroupSecrets,
  hubModels,
  hubModelAliases,
  hubModelPriceVersions,
  hubModelPriceComponents,
  hubGroupPriceVersions,
  hubGroupModels,
];

const migrationsDirectory = resolve(__dirname, "../migrations");
const stageAMigrationFile = readdirSync(migrationsDirectory).find((file) =>
  /^0006_.*\.sql$/.test(file),
);

if (!stageAMigrationFile) {
  throw new Error("Stage A migration 0006 was not found");
}

const stageAMigration = readFileSync(
  resolve(migrationsDirectory, stageAMigrationFile),
  "utf8",
);

describe("LLMHub v2 Stage A schema", () => {
  test("uses isolated hub_* tables and keeps v1 names intact", () => {
    expect(stageATables.map((table) => getTableConfig(table).name)).toEqual([
      "hub_providers",
      "hub_provider_groups",
      "hub_group_blocks",
      "hub_group_secrets",
      "hub_models",
      "hub_model_aliases",
      "hub_model_price_versions",
      "hub_model_price_components",
      "hub_group_price_versions",
      "hub_group_models",
    ]);
    expect(getTableConfig(providers).name).toBe("providers");
    expect(getTableConfig(models).name).toBe("models");
  });

  test("keeps one active block per group, source and reason", () => {
    const activeBlockIndex = getTableConfig(hubGroupBlocks).indexes.find(
      (index) => index.config.name === "hub_group_blocks_active_uidx",
    );

    expect(activeBlockIndex?.config.unique).toBe(true);
    expect(activeBlockIndex?.config.where).toBeDefined();
  });

  test("uniquely identifies upstream models inside a group", () => {
    const upstreamIdentity = getTableConfig(hubGroupModels).indexes.find(
      (index) => index.config.name === "hub_group_models_upstream_name_uidx",
    );

    expect(upstreamIdentity?.config.unique).toBe(true);
    expect(upstreamIdentity?.config.columns).toHaveLength(2);
  });

  test("ships database checks for mapping, balance and price windows", () => {
    expect(stageAMigration).toContain(
      '"hub_group_models"."discovery_status" <> \'unmapped\'',
    );
    expect(stageAMigration).toContain(
      '"hub_provider_groups"."last_balance_micros" IS NULL AND "hub_provider_groups"."balance_currency" IS NULL',
    );
    expect(stageAMigration).toContain(
      'CONSTRAINT "hub_model_price_versions_window_check"',
    );
    expect(stageAMigration).toContain(
      'CONSTRAINT "hub_group_price_versions_window_check"',
    );
  });

  test("rejects overlapping model and group price versions", () => {
    expect(stageAMigration).toContain(
      'CREATE EXTENSION IF NOT EXISTS "btree_gist"',
    );
    expect(stageAMigration).toContain(
      'CONSTRAINT "hub_model_price_versions_no_overlap_excl" EXCLUDE USING gist',
    );
    expect(stageAMigration).toContain(
      'CONSTRAINT "hub_group_price_versions_no_overlap_excl" EXCLUDE USING gist',
    );
    expect(stageAMigration.match(/tstzrange\(/g)).toHaveLength(2);
  });
});
