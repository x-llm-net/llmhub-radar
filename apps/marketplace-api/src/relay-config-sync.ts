import { createHash } from "node:crypto";

import {
  claimDueHubConfigTasks,
  clearHubGroupModelRelayBinding,
  createMarketplaceDb,
  deactivateHubRelayChannelBindings,
  getHubRelayProjectionSource,
  isHubConfigTaskStale,
  listHubRelayChannelBindings,
  markHubConfigTaskApplied,
  markHubConfigTaskFailed,
  setHubGroupModelRelayBinding,
  type ClaimedHubConfigTask,
  type HubRelayProjectionSource,
  type MarketplaceDb,
  upsertHubRelayChannelBinding,
} from "@llmhub/marketplace-db";
import {
  decryptSecret,
  normalizeRadarBaseUrl,
} from "@openstatus/services/radar/runtime";

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LEASE_MS = 5 * 60_000;

export type HubRelayRoute = {
  sourceRef: string;
  routeKey: string;
  relayGroup: string;
  configVersion: number;
  multiplierBps: number;
  baseUrl: string;
  apiKey: string;
  models: Record<string, string>;
  groupModelIds: string[];
  configChecksum: string;
};

export type HubRelayAdapter = {
  upsertRoute(route: HubRelayRoute): Promise<{ externalChannelId: string }>;
  disableRoute(input: {
    sourceRef: string;
    externalChannelId: string;
    configVersion: number;
  }): Promise<void>;
};

export async function buildHubRelayProjection(
  source: HubRelayProjectionSource,
  decrypt: (ciphertext: string) => Promise<string> = decryptSecret,
): Promise<HubRelayRoute[]> {
  if (
    source.lifecycleStatus !== "ready" ||
    source.desiredStatus !== "active" ||
    source.listingStatus !== "listed"
  ) {
    return [];
  }
  if (source.multiplierBps === null) {
    throw new Error("Hub provider group has no active multiplier");
  }
  const multiplierBps = source.multiplierBps;

  const apiKey = await decrypt(source.apiKeyCiphertext);
  const ciphertexts = new Set([
    source.baseUrlCiphertext,
    ...source.models.flatMap((model) =>
      model.baseUrlOverrideCiphertext ? [model.baseUrlOverrideCiphertext] : [],
    ),
  ]);
  const decryptedUrls = new Map<string, string>();
  await Promise.all(
    [...ciphertexts].map(async (ciphertext) => {
      decryptedUrls.set(
        ciphertext,
        normalizeRadarBaseUrl(await decrypt(ciphertext)),
      );
    }),
  );

  const routes = new Map<
    string,
    {
      baseUrl: string;
      models: Map<string, string>;
      groupModelIds: Set<string>;
    }
  >();
  const sortedModels = [...source.models].sort(
    (left, right) =>
      left.canonicalModel.localeCompare(right.canonicalModel) ||
      left.upstreamModel.localeCompare(right.upstreamModel),
  );
  for (const model of sortedModels) {
    const ciphertext =
      model.baseUrlOverrideCiphertext ?? source.baseUrlCiphertext;
    const baseUrl = decryptedUrls.get(ciphertext);
    if (!baseUrl) throw new Error("Unable to decrypt a route Base URL");
    const routeKey = shortHash(baseUrl);
    const route = routes.get(routeKey) ?? {
      baseUrl,
      models: new Map(),
      groupModelIds: new Set(),
    };
    // A runtime channel can expose each canonical name once. Discovery is sorted,
    // so choosing the first alias is deterministic.
    if (!route.models.has(model.canonicalModel)) {
      route.models.set(model.canonicalModel, model.upstreamModel);
    }
    route.groupModelIds.add(model.groupModelId);
    routes.set(routeKey, route);
  }

  const relayGroup = `lhg_${source.groupId.replaceAll("-", "")}`;
  return [...routes.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([routeKey, route]) => {
      const models = Object.fromEntries(
        [...route.models.entries()].sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      );
      const sourceRef = `llmhub:${source.groupId}:${routeKey}`;
      return {
        sourceRef,
        routeKey,
        relayGroup,
        configVersion: source.configVersion,
        multiplierBps,
        baseUrl: route.baseUrl,
        apiKey,
        models,
        groupModelIds: [...route.groupModelIds].sort(),
        configChecksum: checksum({
          sourceRef,
          relayGroup,
          multiplierBps,
          baseUrl: route.baseUrl,
          models,
        }),
      };
    });
}

export async function reconcileHubRelayRoutes(input: {
  adapter: HubRelayAdapter;
  groupId: string;
  configVersion: number;
  routes: HubRelayRoute[];
  existingBindings: Array<{
    routeKey: string;
    externalChannelId: string;
    active: boolean;
  }>;
}) {
  const applied = [];
  for (const route of input.routes) {
    const result = await input.adapter.upsertRoute(route);
    applied.push({ route, externalChannelId: result.externalChannelId });
  }

  const activeRouteKeys = new Set(input.routes.map((route) => route.routeKey));
  const removed = input.existingBindings.filter(
    (binding) => binding.active && !activeRouteKeys.has(binding.routeKey),
  );
  for (const binding of removed) {
    await input.adapter.disableRoute({
      sourceRef: `llmhub:${input.groupId}:${binding.routeKey}`,
      externalChannelId: binding.externalChannelId,
      configVersion: input.configVersion,
    });
  }
  return { applied, removedRouteKeys: removed.map((item) => item.routeKey) };
}

export async function runHubConfigSyncBatch(
  db: MarketplaceDb,
  adapter: HubRelayAdapter,
  options: { batchSize?: number } = {},
) {
  const tasks = await claimDueHubConfigTasks(db, {
    limit: options.batchSize ?? DEFAULT_BATCH_SIZE,
    leaseMs: DEFAULT_LEASE_MS,
  });
  await Promise.all(tasks.map((task) => applyTask(db, adapter, task)));
  return { claimed: tasks.length };
}

async function applyTask(
  db: MarketplaceDb,
  adapter: HubRelayAdapter,
  task: ClaimedHubConfigTask,
) {
  try {
    if (task.stale || (await isHubConfigTaskStale(db, task))) {
      await markHubConfigTaskApplied(db, task);
      return;
    }
    const [source, existingBindings] = await Promise.all([
      getHubRelayProjectionSource(db, task.groupId),
      listHubRelayChannelBindings(db, task.groupId),
    ]);
    if (!source) throw new Error("Hub provider group not found");
    const routes =
      task.action === "upsert" ? await buildHubRelayProjection(source) : [];
    const result = await reconcileHubRelayRoutes({
      adapter,
      groupId: task.groupId,
      configVersion: task.configVersion,
      routes,
      existingBindings,
    });

    const bindingResults = [];
    for (const item of result.applied) {
      const bindingResult = await upsertHubRelayChannelBinding(db, {
        groupId: task.groupId,
        routeKey: item.route.routeKey,
        externalChannelId: item.externalChannelId,
        configVersion: task.configVersion,
        configChecksum: item.route.configChecksum,
      });
      bindingResults.push({ item, bindingResult });
    }

    // A model can move between Base URLs while keeping the same group. Clear
    // every previous association before assigning the current projection.
    for (const binding of existingBindings) {
      await clearHubGroupModelRelayBinding(db, binding.id);
    }
    for (const { item, bindingResult } of bindingResults) {
      if (bindingResult.status === "stale" || !bindingResult.binding) continue;
      await setHubGroupModelRelayBinding(db, {
        groupModelIds: item.route.groupModelIds,
        relayChannelBindingId: bindingResult.binding.id,
      });
    }
    await deactivateHubRelayChannelBindings(db, {
      groupId: task.groupId,
      configVersion: task.configVersion,
      routeKeys: result.removedRouteKeys,
    });
    await markHubConfigTaskApplied(db, task);
  } catch (error) {
    await markHubConfigTaskFailed(db, task, error);
    console.error("LLMHub config sync failed", {
      groupId: task.groupId,
      message: safeErrorMessage(error),
    });
  }
}

export function createHttpHubRelayAdapter(options: {
  endpoint: string;
  token: string;
  fetch?: typeof fetch;
}): HubRelayAdapter {
  const endpoint = internalRelayEndpoint(options.endpoint);
  const doFetch = options.fetch ?? fetch;
  const request = async (sourceRef: string, body: Record<string, unknown>) => {
    const url = new URL(
      `channels/${encodeURIComponent(sourceRef)}`,
      endpoint.toString().replace(/\/?$/, "/"),
    );
    const response = await doFetch(url, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`Relay adapter returned HTTP ${response.status}`);
    }
    const value: unknown = await response.json();
    if (!isRecord(value) || typeof value.id !== "string" || !value.id) {
      throw new Error("Relay adapter returned an invalid channel id");
    }
    return value.id;
  };

  return {
    async upsertRoute(route) {
      const externalChannelId = await request(route.sourceRef, {
        sourceRef: route.sourceRef,
        configVersion: route.configVersion,
        configChecksum: route.configChecksum,
        enabled: true,
        group: route.relayGroup,
        multiplierBps: route.multiplierBps,
        baseUrl: route.baseUrl,
        apiKey: route.apiKey,
        models: route.models,
      });
      return { externalChannelId };
    },
    async disableRoute(input) {
      await request(input.sourceRef, {
        sourceRef: input.sourceRef,
        externalChannelId: input.externalChannelId,
        configVersion: input.configVersion,
        enabled: false,
      });
    },
  };
}

function internalRelayEndpoint(value: string) {
  const endpoint = new URL(value);
  if (process.env.NODE_ENV === "production" && endpoint.protocol !== "https:") {
    throw new Error("Internal relay endpoints must use HTTPS in production");
  }
  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new Error("Internal relay endpoints must use HTTP or HTTPS");
  }
  if (endpoint.username || endpoint.password) {
    throw new Error("Internal relay endpoints must not include credentials");
  }
  return endpoint;
}

export async function runHubConfigSyncWorker() {
  const databaseUrl = requiredEnv("MARKETPLACE_DATABASE_URL");
  const endpoint = requiredEnv("LLMHUB_RELAY_SYNC_URL");
  const token = requiredEnv("LLMHUB_RELAY_SYNC_TOKEN");
  const pollIntervalMs = positiveInteger(
    "MARKETPLACE_CONFIG_SYNC_POLL_INTERVAL_MS",
    DEFAULT_POLL_INTERVAL_MS,
  );
  const batchSize = positiveInteger(
    "MARKETPLACE_CONFIG_SYNC_BATCH_SIZE",
    DEFAULT_BATCH_SIZE,
  );
  const adapter = createHttpHubRelayAdapter({ endpoint, token });
  const { client, db } = createMarketplaceDb(databaseUrl);
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  console.log("LLMHub config sync worker started", {
    pollIntervalMs,
    batchSize,
  });
  try {
    while (!stopping) {
      try {
        await runHubConfigSyncBatch(db, adapter, { batchSize });
      } catch (error) {
        console.error("LLMHub config sync batch failed", {
          message: safeErrorMessage(error),
        });
      }
      if (!stopping) await sleep(pollIntervalMs);
    }
  } finally {
    await client.close();
  }
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("base64url").slice(0, 16);
}

function checksum(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
