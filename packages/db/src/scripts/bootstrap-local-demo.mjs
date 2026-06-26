import { createClient } from "@libsql/client";

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_AUTH_TOKEN = process.env.DATABASE_AUTH_TOKEN;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const db = createClient({
  url: DATABASE_URL,
  authToken: DATABASE_AUTH_TOKEN,
});

const DEMO = {
  workspaceSlug: "llmhub-demo",
  workspaceName: "LLMHub Demo",
  userEmail: "demo@llmhub.local",
  userName: "LLMHub Demo",
  pageSlug: "skyhope-model-status",
  pageTitle: "Skyhope 服务状态",
  pageDescription: "Skyhope 多个 API 密钥的模型稳定性与首 Token 观测。",
  providerName: "Skyhope",
  baseUrl: "https://ai-tob.twskyhope.top",
  subscriberEmail: "watcher@llmhub.local",
};

const DEMO_SECRET = process.env.RADAR_CREDENTIAL_SECRET || "llmhub-radar-dev-secret-change-me";

function seconds(date) {
  return Math.floor(date.getTime() / 1000);
}

function base64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

async function sha256Bytes(input) {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return new Uint8Array(digest);
}

async function hashSecret(input) {
  return base64(await sha256Bytes(input)).slice(0, 64);
}

async function encryptSecret(plainText) {
  const keyBytes = await sha256Bytes(DEMO_SECRET);
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    keyBytes.buffer.slice(
      keyBytes.byteOffset,
      keyBytes.byteOffset + keyBytes.byteLength,
    ),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const cipher = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plainText),
  );
  return `v1.${base64(iv)}.${base64(new Uint8Array(cipher))}`;
}

function percentile(values, pct) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? null;
}

async function execute(sql, args = []) {
  return db.execute({ sql, args });
}

async function getOne(sql, args = []) {
  const result = await execute(sql, args);
  return result.rows[0] ?? null;
}

async function insertReturningId(sql, args = []) {
  const row = await getOne(sql, args);
  if (!row?.id) throw new Error(`Insert failed: ${sql}`);
  return Number(row.id);
}

async function ensureWorkspace() {
  const existing = await getOne(
    "select id from workspace where slug = ?",
    [DEMO.workspaceSlug],
  );

  if (existing?.id) return Number(existing.id);

  return insertReturningId(
    `
      insert into workspace (
        slug, name, stripe_id, subscription_id, plan, limits, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?)
      returning id
    `,
    [
      DEMO.workspaceSlug,
      DEMO.workspaceName,
      "demo-stripe",
      "demo-subscription",
      "team",
      JSON.stringify({
        monitors: 50,
        "synthetic-checks": 150000,
        periodicity: ["30s", "1m", "5m", "10m", "30m", "1h"],
        "multi-region": true,
        "status-pages": 20,
        "status-subscribers": true,
      }),
      seconds(new Date()),
    ],
  );
}

async function ensureUser(workspaceId) {
  let userId = null;
  const existing = await getOne(
    "select id from user where email = ? order by id asc limit 1",
    [DEMO.userEmail],
  );

  if (existing?.id) {
    userId = Number(existing.id);
  } else {
    userId = await insertReturningId(
      `
        insert into user (email, name, first_name, last_name, photo_url, updated_at)
        values (?, ?, ?, ?, ?, ?)
        returning id
      `,
      [DEMO.userEmail, DEMO.userName, "LLMHub", "Demo", "", seconds(new Date())],
    );
  }

  await execute(
    `
      insert or ignore into users_to_workspaces (user_id, workspace_id, role, created_at)
      values (?, ?, 'owner', ?)
    `,
    [userId, workspaceId, seconds(new Date())],
  );

  return userId;
}

async function clearDemoPage() {
  const pageRow = await getOne("select id from page where slug = ?", [DEMO.pageSlug]);
  if (pageRow?.id) {
    await execute(
      "delete from page_subscriber_to_page_component where page_subscriber_id in (select id from page_subscriber where page_id = ?)",
      [Number(pageRow.id)],
    );
    await execute("delete from page_subscriber where page_id = ?", [Number(pageRow.id)]);
  }

  await execute("delete from radar_pool where slug = ?", [DEMO.pageSlug]);
  await execute("delete from page where slug = ?", [DEMO.pageSlug]);
}

async function createPage(workspaceId) {
  return insertReturningId(
    `
      insert into page (
        workspace_id, title, description, icon, slug, custom_domain, published,
        updated_at, password_protected, show_monitor_values, force_theme,
        legacy_page, configuration, access_type, default_locale, locales,
        allow_index
      ) values (?, ?, ?, ?, ?, ?, 1, ?, 0, 1, ?, 1, ?, 'public', ?, ?, 1)
      returning id
    `,
    [
      workspaceId,
      DEMO.pageTitle,
      DEMO.pageDescription,
      "",
      DEMO.pageSlug,
      "",
      seconds(new Date()),
      "light",
      JSON.stringify({
        value: "manual",
        type: "manual",
        uptime: true,
        theme: "default",
      }),
      "zh",
      JSON.stringify(["zh", "en"]),
    ],
  );
}

async function createPool(workspaceId, pageId) {
  return insertReturningId(
    `
      insert into radar_pool (
        workspace_id, name, slug, description, visibility, public_pool_opt_in, page_id, updated_at
      ) values (?, ?, ?, ?, 'private', 1, ?, ?)
      returning id
    `,
    [
      workspaceId,
      DEMO.pageTitle,
      DEMO.pageSlug,
      DEMO.pageDescription,
      pageId,
      seconds(new Date()),
    ],
  );
}

async function createProvider(workspaceId, poolId) {
  const baseUrlEncrypted = await encryptSecret(DEMO.baseUrl);
  const hostname = new URL(DEMO.baseUrl).hostname.toLowerCase();
  const baseUrlHostHash = await hashSecret(hostname);

  return insertReturningId(
    `
      insert into radar_provider (
        workspace_id, pool_id, name, display_name, base_url_encrypted,
        base_url_host_hash, base_url_visibility, provider_type, enabled, notes, updated_at
      ) values (?, ?, ?, ?, ?, ?, 'hidden', 'openai_compatible', 1, '', ?)
      returning id
    `,
    [
      workspaceId,
      poolId,
      DEMO.providerName,
      DEMO.providerName,
      baseUrlEncrypted,
      baseUrlHostHash,
      seconds(new Date()),
    ],
  );
}

async function createCredential(workspaceId, providerId, item) {
  const encryptedApiKey = await encryptSecret(item.apiKey);
  const keyFingerprint = await hashSecret(item.apiKey);

  return insertReturningId(
    `
      insert into radar_credential (
        workspace_id, provider_id, name, description, encrypted_api_key,
        key_fingerprint, last_four, billing_group, model_group, model_catalog,
        daily_probe_limit, daily_token_limit, daily_cost_limit_cents,
        enabled, updated_at
      ) values (?, ?, ?, '', ?, ?, ?, ?, ?, ?, 288, 2000, 100, 1, ?)
      returning id
    `,
    [
      workspaceId,
      providerId,
      item.name,
      encryptedApiKey,
      keyFingerprint,
      item.apiKey.slice(-4),
      item.name,
      item.modelGroup,
      JSON.stringify(item.models),
      seconds(new Date()),
    ],
  );
}

async function createTarget(workspaceId, poolId, providerId, credentialId, item, status) {
  return insertReturningId(
    `
      insert into radar_probe_target (
        workspace_id, pool_id, provider_id, credential_id, name, display_name,
        model_name, endpoint_type, interval_seconds, timeout_ms, max_tokens,
        stream_enabled, enabled, current_status, updated_at, next_check_at,
        last_check_started_at, locked_until
      ) values (?, ?, ?, ?, ?, ?, ?, 'chat_completions', 600, 20000, 8, 1, 1, ?, ?, ?, ?, null)
      returning id
    `,
    [
      workspaceId,
      poolId,
      providerId,
      credentialId,
      `${DEMO.providerName} / ${item.name}`,
      item.name,
      item.probeModel,
      status,
      seconds(new Date()),
      seconds(new Date(Date.now() + 10 * 60 * 1000)),
      seconds(new Date()),
    ],
  );
}

async function insertRunsAndStatus(workspaceId, poolId, providerId, targetId, credentialId, status, runs) {
  const now = Date.now();

  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const run = runs[i];
    const startedAt = new Date(now - i * 10 * 60 * 1000);
    const finishedAt = new Date(startedAt.getTime() + run.totalLatencyMs);
    const credentialIdHash = await hashSecret(String(credentialId));

    await execute(
      `
        insert into radar_probe_run (
          workspace_id, pool_id, target_id, provider_id, credential_id_hash, region,
          started_at, finished_at, success, http_status, error_type, safe_error_summary,
          ttfb_ms, first_token_ms, total_latency_ms, tokens_in, tokens_out, tokens_per_second,
          prompt_template_version
        ) values (?, ?, ?, ?, ?, 'default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'health-v1')
      `,
      [
        workspaceId,
        poolId,
        targetId,
        providerId,
        credentialIdHash,
        seconds(startedAt),
        seconds(finishedAt),
        run.success ? 1 : 0,
        run.httpStatus,
        run.errorType ?? null,
        run.safeErrorSummary ?? null,
        run.firstTokenMs != null ? Math.max(50, run.firstTokenMs - 150) : null,
        run.firstTokenMs ?? null,
        run.totalLatencyMs,
        run.success ? 120 : null,
        run.success ? 48 : null,
        run.success ? Math.round((48 / run.totalLatencyMs) * 1000) : null,
      ],
    );
  }

  const successes = runs.filter((run) => run.success).length;
  const firstTokens = runs
    .map((run) => run.firstTokenMs)
    .filter((value) => Number.isFinite(value));
  const lastRun = runs[runs.length - 1];

  await execute(
    `
      insert into radar_target_status (
        workspace_id, target_id, sample_count_1h, success_rate_1h,
        sample_count_24h, success_rate_24h, p50_first_token_ms, p95_first_token_ms,
        p50_total_latency_ms, p95_total_latency_ms, error_count_by_type,
        last_check_at, last_success_at, last_failure_at, current_status, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      workspaceId,
      targetId,
      Math.min(6, runs.length),
      status === "degraded" ? 8333 : 10000,
      runs.length,
      Math.round((successes / runs.length) * 10000),
      firstTokens.length ? percentile(firstTokens, 50) : null,
      firstTokens.length ? percentile(firstTokens, 95) : null,
      percentile(runs.map((run) => run.totalLatencyMs), 50),
      percentile(runs.map((run) => run.totalLatencyMs), 95),
      JSON.stringify(
        runs.reduce((acc, run) => {
          if (run.errorType) acc[run.errorType] = (acc[run.errorType] ?? 0) + 1;
          return acc;
        }, {}),
      ),
      seconds(new Date()),
      lastRun.success ? seconds(new Date()) : seconds(new Date(Date.now() - 10 * 60 * 1000)),
      lastRun.success ? null : seconds(new Date()),
      status,
      seconds(new Date()),
    ],
  );
}

async function insertSubscriber(pageId) {
  await execute(
    `
      insert into page_subscriber (
        email, page_id, channel_type, accepted_at, created_at, updated_at, source, name
      ) values (?, ?, 'email', ?, ?, ?, 'vendor', ?)
    `,
    [
      DEMO.subscriberEmail,
      pageId,
      seconds(new Date()),
      seconds(new Date()),
      seconds(new Date()),
      "Demo subscriber",
    ],
  );
}

async function main() {
  const workspaceId = await ensureWorkspace();
  await ensureUser(workspaceId);
  await clearDemoPage();

  const pageId = await createPage(workspaceId);
  const poolId = await createPool(workspaceId, pageId);
  const providerId = await createProvider(workspaceId, poolId);

  const definitions = [
    {
      name: "OpenAI 主力分组",
      modelGroup: "OpenAI",
      probeModel: "gpt-4.1-mini",
      apiKey: "sk-demo-skyhope-openai-0001",
      models: [
        "gpt-4.1-mini",
        "gpt-4o-mini",
        "gpt-4.1",
        "o4-mini",
        "text-embedding-3-large",
      ],
      status: "operational",
      runs: [
        { success: true, httpStatus: 200, firstTokenMs: 1800, totalLatencyMs: 4200 },
        { success: true, httpStatus: 200, firstTokenMs: 1900, totalLatencyMs: 4300 },
        { success: true, httpStatus: 200, firstTokenMs: 2000, totalLatencyMs: 4400 },
        { success: true, httpStatus: 200, firstTokenMs: 2100, totalLatencyMs: 4500 },
        { success: true, httpStatus: 200, firstTokenMs: 2200, totalLatencyMs: 4600 },
        { success: true, httpStatus: 200, firstTokenMs: 2300, totalLatencyMs: 4700 },
        { success: true, httpStatus: 200, firstTokenMs: 2000, totalLatencyMs: 4300 },
        { success: true, httpStatus: 200, firstTokenMs: 2400, totalLatencyMs: 4800 },
        { success: true, httpStatus: 200, firstTokenMs: 2100, totalLatencyMs: 4500 },
        { success: true, httpStatus: 200, firstTokenMs: 2200, totalLatencyMs: 4600 },
        { success: true, httpStatus: 200, firstTokenMs: 2500, totalLatencyMs: 4900 },
        { success: true, httpStatus: 200, firstTokenMs: 2000, totalLatencyMs: 4400 },
      ],
    },
    {
      name: "Claude 高稳分组",
      modelGroup: "Anthropic",
      probeModel: "claude-3-5-sonnet-20241022",
      apiKey: "sk-demo-skyhope-claude-0002",
      models: [
        "claude-3-5-sonnet-20241022",
        "claude-3-7-sonnet-20250219",
        "claude-3-5-haiku-20241022",
      ],
      status: "operational",
      runs: [
        { success: true, httpStatus: 200, firstTokenMs: 3800, totalLatencyMs: 7600 },
        { success: true, httpStatus: 200, firstTokenMs: 3900, totalLatencyMs: 7700 },
        { success: true, httpStatus: 200, firstTokenMs: 4100, totalLatencyMs: 7900 },
        { success: true, httpStatus: 200, firstTokenMs: 4300, totalLatencyMs: 8200 },
        { success: true, httpStatus: 200, firstTokenMs: 4500, totalLatencyMs: 8500 },
        { success: true, httpStatus: 200, firstTokenMs: 4700, totalLatencyMs: 8800 },
        { success: true, httpStatus: 200, firstTokenMs: 4200, totalLatencyMs: 8000 },
        { success: true, httpStatus: 200, firstTokenMs: 4400, totalLatencyMs: 8300 },
        { success: true, httpStatus: 200, firstTokenMs: 4600, totalLatencyMs: 8600 },
        { success: true, httpStatus: 200, firstTokenMs: 4800, totalLatencyMs: 9000 },
        { success: true, httpStatus: 200, firstTokenMs: 4300, totalLatencyMs: 8200 },
        { success: true, httpStatus: 200, firstTokenMs: 4000, totalLatencyMs: 7800 },
      ],
    },
    {
      name: "Gemini 经济分组",
      modelGroup: "Google",
      probeModel: "gemini-2.0-flash",
      apiKey: "sk-demo-skyhope-gemini-0003",
      models: [
        "gemini-2.0-flash",
        "gemini-2.5-flash-preview",
        "gemini-1.5-pro",
      ],
      status: "degraded",
      runs: [
        { success: false, httpStatus: 502, errorType: "server_error", safeErrorSummary: "HTTP 502 from upstream", totalLatencyMs: 12000 },
        { success: true, httpStatus: 200, firstTokenMs: 6200, totalLatencyMs: 11800 },
        { success: true, httpStatus: 200, firstTokenMs: 5800, totalLatencyMs: 10900 },
        { success: true, httpStatus: 200, firstTokenMs: 7100, totalLatencyMs: 12500 },
        { success: true, httpStatus: 200, firstTokenMs: 6600, totalLatencyMs: 11900 },
        { success: false, httpStatus: 504, errorType: "timeout", safeErrorSummary: "Probe timeout", totalLatencyMs: 20000 },
        { success: true, httpStatus: 200, firstTokenMs: 6900, totalLatencyMs: 12000 },
        { success: true, httpStatus: 200, firstTokenMs: 6400, totalLatencyMs: 11500 },
        { success: true, httpStatus: 200, firstTokenMs: 6100, totalLatencyMs: 11200 },
        { success: true, httpStatus: 200, firstTokenMs: 5700, totalLatencyMs: 10800 },
        { success: true, httpStatus: 200, firstTokenMs: 6300, totalLatencyMs: 11300 },
        { success: true, httpStatus: 200, firstTokenMs: 6000, totalLatencyMs: 11000 },
      ],
    },
  ];

  for (const item of definitions) {
    const credentialId = await createCredential(workspaceId, providerId, item);
    const targetId = await createTarget(
      workspaceId,
      poolId,
      providerId,
      credentialId,
      item,
      item.status,
    );
    await insertRunsAndStatus(
      workspaceId,
      poolId,
      providerId,
      targetId,
      credentialId,
      item.status,
      item.runs,
    );
  }

  await insertSubscriber(pageId);

  console.log(
    JSON.stringify({
      ok: true,
      pageSlug: DEMO.pageSlug,
      loginEmail: DEMO.userEmail,
      workspaceSlug: DEMO.workspaceSlug,
    }),
  );
}

await main();
