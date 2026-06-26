import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient, type Client, type InValue } from "@libsql/client";

type Journal = {
  entries: {
    idx: number;
    tag: string;
  }[];
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "../..");
const migrationsFolder = resolve(packageRoot, "drizzle");
const runtimeDir = resolve(tmpdir(), "llmhub-radar-migration-checks");

async function main() {
  await verifyEmptyDatabaseMigration();
  await verifyExistingDatabaseMigration();

  console.log("[radar-migrations] verification completed");
}

async function verifyEmptyDatabaseMigration() {
  const db = await createTemporaryDatabase("empty");

  try {
    await applyMigrations(db.client);
    await assertColumnExists(db.client, "page_subscriber", "locale");
    await assertColumnExists(
      db.client,
      "radar_target_openstatus_binding",
      "page_component_id",
    );
    await assertIndexExists(
      db.client,
      "radar_target_openstatus_binding",
      "radar_binding_page_component_id_idx",
    );

    console.log("[radar-migrations] empty database migration ok");
  } finally {
    await cleanupTemporaryDatabase(db);
  }
}

async function verifyExistingDatabaseMigration() {
  const db = await createTemporaryDatabase("existing");

  try {
    await applyMigrations(db.client, { maxIdx: 80 });
    await assertColumnMissing(db.client, "page_subscriber", "locale");
    await assertColumnMissing(
      db.client,
      "radar_target_openstatus_binding",
      "page_component_id",
    );

    const seeded = await seedPre0081RadarData(db.client);
    const before = await readExistingDataSnapshot(db.client, seeded);

    await applyMigrations(db.client, { minIdx: 81 });

    await assertColumnExists(db.client, "page_subscriber", "locale");
    await assertColumnExists(
      db.client,
      "radar_target_openstatus_binding",
      "page_component_id",
    );
    await assertIndexExists(
      db.client,
      "radar_target_openstatus_binding",
      "radar_binding_page_component_id_idx",
    );

    await assertExistingOpenStatusDataPreserved(db.client, seeded, before);
    await assertRadarTargetComponentsBackfilled(db.client, seeded);

    console.log("[radar-migrations] existing database migration ok");
  } finally {
    await cleanupTemporaryDatabase(db);
  }
}

async function applyMigrations(
  client: Client,
  options: { minIdx?: number; maxIdx?: number } = {},
) {
  const journal = JSON.parse(
    await readFile(resolve(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as Journal;

  for (const entry of journal.entries) {
    if (options.minIdx !== undefined && entry.idx < options.minIdx) continue;
    if (options.maxIdx !== undefined && entry.idx > options.maxIdx) continue;

    const file = resolve(migrationsFolder, `${entry.tag}.sql`);
    const content = await readFile(file, "utf8");
    const statements = content
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await client.execute(statement);
    }
  }
}

async function seedPre0081RadarData(client: Client) {
  const now = Math.floor(Date.now() / 1000);

  const workspaceId = await insertReturningId(
    client,
    `
      insert into workspace (slug, name, stripe_id, subscription_id, plan, limits, updated_at)
      values (?, ?, ?, ?, ?, ?, ?)
      returning id
    `,
    [
      "migration-check",
      "Migration Check",
      "migration-check-stripe",
      "migration-check-subscription",
      "team",
      "{}",
      now,
    ],
  );

  const pageId = await insertReturningId(
    client,
    `
      insert into page (
        workspace_id, title, description, icon, slug, custom_domain, published,
        updated_at, password_protected, show_monitor_values, force_theme,
        legacy_page, configuration, access_type, default_locale, locales,
        allow_index
      ) values (?, ?, ?, ?, ?, ?, 1, ?, 0, 1, 'light', 1, ?, 'public', 'zh', ?, 1)
      returning id
    `,
    [
      workspaceId,
      "Migration Check Status",
      "Existing OpenStatus page",
      "",
      "migration-check",
      "",
      now,
      JSON.stringify({ theme: "default" }),
      JSON.stringify(["zh", "en"]),
    ],
  );

  const subscriberId = await insertReturningId(
    client,
    `
      insert into page_subscriber (
        email, page_id, channel_type, token, accepted_at, created_at,
        updated_at, source, name
      ) values (?, ?, 'email', ?, ?, ?, ?, 'vendor', ?)
      returning id
    `,
    [
      "migration-check@example.com",
      pageId,
      randomUUID(),
      now,
      now,
      now,
      "Existing subscriber",
    ],
  );

  const existingComponentId = await insertReturningId(
    client,
    `
      insert into page_component (
        workspace_id, page_id, type, monitor_id, name, description,
        "order", created_at, updated_at
      ) values (?, ?, 'static', null, ?, ?, ?, ?, ?)
      returning id
    `,
    [
      workspaceId,
      pageId,
      "Existing OpenStatus Component",
      "Must not be changed by radar migration",
      999,
      now,
      now,
    ],
  );

  const poolId = await insertReturningId(
    client,
    `
      insert into radar_pool (
        workspace_id, name, slug, description, visibility,
        public_pool_opt_in, page_id, updated_at
      ) values (?, ?, ?, ?, 'private', 1, ?, ?)
      returning id
    `,
    [
      workspaceId,
      "Migration Check Provider",
      "migration-check-provider",
      "Radar provider with an existing status page",
      pageId,
      now,
    ],
  );

  const providerId = await insertReturningId(
    client,
    `
      insert into radar_provider (
        workspace_id, pool_id, name, display_name, base_url_encrypted,
        base_url_host_hash, base_url_visibility, provider_type, enabled,
        notes, updated_at
      ) values (?, ?, ?, ?, ?, ?, 'hidden', 'openai_compatible', 1, '', ?)
      returning id
    `,
    [
      workspaceId,
      poolId,
      "migration-check-provider",
      "Migration Check Provider",
      "encrypted-base-url",
      "host-hash",
      now,
    ],
  );

  const credentialId = await insertReturningId(
    client,
    `
      insert into radar_credential (
        workspace_id, provider_id, name, encrypted_api_key, key_fingerprint,
        last_four, billing_group, model_group, model_catalog, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      returning id
    `,
    [
      workspaceId,
      providerId,
      "OpenAI group",
      "encrypted-api-key",
      "fingerprint",
      "1234",
      "OpenAI group",
      "OpenAI",
      JSON.stringify(["gpt-4o-mini", "gpt-4.1-mini"]),
      now,
    ],
  );

  const boundTargetId = await insertRadarTarget(client, {
    workspaceId,
    poolId,
    providerId,
    credentialId,
    name: "Existing Binding",
    displayName: "Existing Binding API Key",
    modelName: "gpt-4o-mini",
    now,
  });

  const unboundTargetId = await insertRadarTarget(client, {
    workspaceId,
    poolId,
    providerId,
    credentialId,
    name: "Missing Binding",
    displayName: "Missing Binding API Key",
    modelName: "gpt-4.1-mini",
    now,
  });

  const existingBindingId = await insertReturningId(
    client,
    `
      insert into radar_target_openstatus_binding (
        workspace_id, pool_id, target_id, page_id, monitor_id, created_at,
        updated_at
      ) values (?, ?, ?, ?, null, ?, ?)
      returning id
    `,
    [workspaceId, poolId, boundTargetId, pageId, now, now],
  );

  return {
    workspaceId,
    pageId,
    subscriberId,
    existingComponentId,
    poolId,
    boundTargetId,
    unboundTargetId,
    existingBindingId,
  };
}

async function insertRadarTarget(
  client: Client,
  input: {
    workspaceId: number;
    poolId: number;
    providerId: number;
    credentialId: number;
    name: string;
    displayName: string;
    modelName: string;
    now: number;
  },
) {
  return insertReturningId(
    client,
    `
      insert into radar_probe_target (
        workspace_id, pool_id, provider_id, credential_id, name,
        display_name, model_name, endpoint_type, interval_seconds,
        timeout_ms, max_tokens, stream_enabled, enabled, next_check_at,
        last_check_started_at, locked_until, current_status, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, 'chat_completions', 600, 20000, 8, 1, 1, ?, null, null, 'unknown', ?)
      returning id
    `,
    [
      input.workspaceId,
      input.poolId,
      input.providerId,
      input.credentialId,
      input.name,
      input.displayName,
      input.modelName,
      input.now,
      input.now,
    ],
  );
}

async function readExistingDataSnapshot(
  client: Client,
  seeded: Awaited<ReturnType<typeof seedPre0081RadarData>>,
) {
  return {
    page: await getRequiredRow<{
      title: string;
      description: string;
      slug: string;
    }>(client, "select title, description, slug from page where id = ?", [
      seeded.pageId,
    ]),
    subscriber: await getRequiredRow<{ email: string; name: string }>(
      client,
      "select email, name from page_subscriber where id = ?",
      [seeded.subscriberId],
    ),
    existingComponent: await getRequiredRow<{
      name: string;
      description: string;
      order: number;
    }>(
      client,
      'select name, description, "order" as "order" from page_component where id = ?',
      [seeded.existingComponentId],
    ),
    pageComponentCount: await countRows(client, "page_component"),
    bindingCount: await countRows(client, "radar_target_openstatus_binding"),
  };
}

async function assertExistingOpenStatusDataPreserved(
  client: Client,
  seeded: Awaited<ReturnType<typeof seedPre0081RadarData>>,
  before: Awaited<ReturnType<typeof readExistingDataSnapshot>>,
) {
  const page = await getRequiredRow<{
    title: string;
    description: string;
    slug: string;
  }>(client, "select title, description, slug from page where id = ?", [
    seeded.pageId,
  ]);
  assertEqual(page.title, before.page.title, "page title changed");
  assertEqual(
    page.description,
    before.page.description,
    "page description changed",
  );
  assertEqual(page.slug, before.page.slug, "page slug changed");

  const subscriber = await getRequiredRow<{
    email: string;
    name: string;
    locale: string | null;
  }>(client, "select email, name, locale from page_subscriber where id = ?", [
    seeded.subscriberId,
  ]);
  assertEqual(
    subscriber.email,
    before.subscriber.email,
    "subscriber email changed",
  );
  assertEqual(
    subscriber.name,
    before.subscriber.name,
    "subscriber name changed",
  );
  assertEqual(
    subscriber.locale,
    null,
    "existing subscriber locale should be null",
  );

  const existingComponent = await getRequiredRow<{
    name: string;
    description: string;
    order: number;
  }>(
    client,
    'select name, description, "order" as "order" from page_component where id = ?',
    [seeded.existingComponentId],
  );
  assertEqual(
    existingComponent.name,
    before.existingComponent.name,
    "existing component name changed",
  );
  assertEqual(
    existingComponent.description,
    before.existingComponent.description,
    "existing component description changed",
  );
  assertEqual(
    Number(existingComponent.order),
    Number(before.existingComponent.order),
    "existing component order changed",
  );
}

async function assertRadarTargetComponentsBackfilled(
  client: Client,
  seeded: Awaited<ReturnType<typeof seedPre0081RadarData>>,
) {
  const pageComponentCount = await countRows(client, "page_component");
  const bindingCount = await countRows(
    client,
    "radar_target_openstatus_binding",
  );
  assertEqual(pageComponentCount, 3, "unexpected page_component count");
  assertEqual(bindingCount, 2, "unexpected radar binding count");

  const rows = await client.execute({
    sql: `
      select
        b.target_id as targetId,
        b.page_id as pageId,
        b.page_component_id as pageComponentId,
        pc.name as componentName,
        pc.description as componentDescription,
        pc.type as componentType,
        pc.monitor_id as monitorId,
        pc."order" as componentOrder
      from radar_target_openstatus_binding b
      inner join page_component pc on pc.id = b.page_component_id
      where b.target_id in (?, ?)
      order by b.target_id asc
    `,
    args: [seeded.boundTargetId, seeded.unboundTargetId],
  });

  assertEqual(rows.rows.length, 2, "not all radar targets were bound");

  for (const row of rows.rows) {
    assertEqual(Number(row.pageId), seeded.pageId, "binding page_id mismatch");
    assertEqual(row.componentType, "static", "radar component must be static");
    assertEqual(row.monitorId, null, "radar component monitor_id must be null");
    assertEqual(
      Number(row.componentOrder),
      Number(row.targetId),
      "radar component order should match target id",
    );

    if (Number(row.targetId) === seeded.boundTargetId) {
      assertEqual(
        row.componentName,
        "Existing Binding API Key",
        "existing binding component name mismatch",
      );
    } else {
      assertEqual(
        row.componentName,
        "Missing Binding API Key",
        "new binding component name mismatch",
      );
    }
  }
}

async function createTemporaryDatabase(label: string) {
  await mkdir(runtimeDir, { recursive: true });
  const dbPath = resolve(runtimeDir, `migration-${label}-${randomUUID()}.db`);
  const client = createClient({
    url: `file:${dbPath.replace(/\\/g, "/")}`,
  });

  return { client, dbPath };
}

async function cleanupTemporaryDatabase(input: {
  client: Client;
  dbPath: string;
}) {
  input.client.close();
  await removeFileWithRetries(input.dbPath);
  await removeFileWithRetries(`${input.dbPath}-shm`);
  await removeFileWithRetries(`${input.dbPath}-wal`);
}

async function removeFileWithRetries(file: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(file, { force: true });
      return;
    } catch (error) {
      if (isBusyFileError(error)) {
        if (attempt < 4) {
          await sleep(100 * (attempt + 1));
          continue;
        }
        return;
      }

      if (attempt === 4) {
        console.warn(
          `[radar-migrations] unable to remove temporary file ${file}`,
        );
        return;
      }

      await sleep(100 * (attempt + 1));
    }
  }
}

function isBusyFileError(error: unknown) {
  return (
    error instanceof Error &&
    ("code" in error || "errno" in error) &&
    ((error as { code?: string }).code === "EBUSY" ||
      (error as { errno?: number }).errno === -16)
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function insertReturningId(client: Client, sql: string, args: InValue[]) {
  const result = await client.execute({ sql, args });
  const id = result.rows[0]?.id;
  if (id === undefined || id === null) {
    throw new Error(`Insert did not return an id: ${sql}`);
  }

  return Number(id);
}

async function getRequiredRow<T>(
  client: Client,
  sql: string,
  args: InValue[] = [],
) {
  const result = await client.execute({ sql, args });
  const row = result.rows[0];
  if (!row) throw new Error(`Expected row not found: ${sql}`);

  return row as T;
}

async function countRows(client: Client, tableName: string) {
  const result = await client.execute(
    `select count(*) as count from ${tableName}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function assertColumnExists(
  client: Client,
  tableName: string,
  columnName: string,
) {
  const columns = await getTableColumns(client, tableName);
  if (!columns.includes(columnName)) {
    throw new Error(`Expected column ${tableName}.${columnName} to exist`);
  }
}

async function assertColumnMissing(
  client: Client,
  tableName: string,
  columnName: string,
) {
  const columns = await getTableColumns(client, tableName);
  if (columns.includes(columnName)) {
    throw new Error(`Expected column ${tableName}.${columnName} to be absent`);
  }
}

async function assertIndexExists(
  client: Client,
  tableName: string,
  indexName: string,
) {
  const result = await client.execute(`pragma index_list('${tableName}')`);
  const indexes = result.rows.map((row) => String(row.name));
  if (!indexes.includes(indexName)) {
    throw new Error(`Expected index ${indexName} on ${tableName}`);
  }
}

async function getTableColumns(client: Client, tableName: string) {
  const result = await client.execute(`pragma table_info('${tableName}')`);
  return result.rows.map((row) => String(row.name));
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

await main();
