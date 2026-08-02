import { describe, expect, test } from "bun:test";

import type { HubRelayProjectionSource } from "@llmhub/marketplace-db";

import {
  buildHubRelayProjection,
  createHttpHubRelayAdapter,
  reconcileHubRelayRoutes,
  type HubRelayAdapter,
} from "./relay-config-sync";

const source: HubRelayProjectionSource = {
  groupId: "11111111-1111-4111-8111-111111111111",
  configVersion: 7,
  lifecycleStatus: "ready",
  desiredStatus: "active",
  listingStatus: "listed",
  baseUrlCiphertext: "base",
  apiKeyCiphertext: "key",
  multiplierBps: 7_500,
  models: [
    {
      groupModelId: "22222222-2222-4222-8222-222222222222",
      canonicalModel: "gpt-5",
      upstreamModel: "openai/gpt-5",
      baseUrlOverrideCiphertext: null,
    },
    {
      groupModelId: "33333333-3333-4333-8333-333333333333",
      canonicalModel: "claude-sonnet-4-6",
      upstreamModel: "claude-sonnet-4-6",
      baseUrlOverrideCiphertext: "special",
    },
  ],
};

const secrets: Record<string, string> = {
  base: "https://api.example.com/v1",
  special: "https://anthropic.example.com/v1",
  key: "sk-test",
};

describe("LLMHub relay config projection", () => {
  test("partitions models by effective Base URL deterministically", async () => {
    const routes = await buildHubRelayProjection(
      source,
      async (ciphertext) => secrets[ciphertext] ?? "",
    );

    expect(routes).toHaveLength(2);
    expect(routes.map((route) => route.models)).toEqual(
      expect.arrayContaining([
        { "gpt-5": "openai/gpt-5" },
        { "claude-sonnet-4-6": "claude-sonnet-4-6" },
      ]),
    );
    expect(routes.map((route) => route.groupModelIds)).toEqual(
      expect.arrayContaining([
        ["22222222-2222-4222-8222-222222222222"],
        ["33333333-3333-4333-8333-333333333333"],
      ]),
    );
    expect(new Set(routes.map((route) => route.routeKey)).size).toBe(2);
    expect(
      routes.every(
        (route) =>
          route.sourceRef === `llmhub:${source.groupId}:${route.routeKey}` &&
          route.relayGroup === "lhg_11111111111141118111111111111111" &&
          route.apiKey === "sk-test" &&
          route.multiplierBps === 7_500 &&
          route.configVersion === 7,
      ),
    ).toBe(true);

    const repeated = await buildHubRelayProjection(
      { ...source, models: [...source.models].reverse() },
      async (ciphertext) => secrets[ciphertext] ?? "",
    );
    expect(repeated).toEqual(routes);
  });

  test("produces no active route when the group is not runtime eligible", async () => {
    expect(
      await buildHubRelayProjection(
        { ...source, listingStatus: "pending" },
        async (ciphertext) => secrets[ciphertext] ?? "",
      ),
    ).toEqual([]);
  });

  test("upserts desired routes and disables only removed routes", async () => {
    const firstModel = source.models[0];
    if (!firstModel) throw new Error("Expected a source model");
    const routes = await buildHubRelayProjection(
      { ...source, models: [firstModel] },
      async (ciphertext) => secrets[ciphertext] ?? "",
    );
    const upserts: string[] = [];
    const disables: string[] = [];
    const firstRoute = routes[0];
    if (!firstRoute) throw new Error("Expected a projected route");
    const adapter: HubRelayAdapter = {
      async upsertRoute(route) {
        upserts.push(route.sourceRef);
        return { externalChannelId: `channel-${route.routeKey}` };
      },
      async disableRoute(input) {
        disables.push(input.sourceRef);
      },
    };

    const result = await reconcileHubRelayRoutes({
      adapter,
      groupId: source.groupId,
      configVersion: source.configVersion,
      routes,
      existingBindings: [
        {
          routeKey: firstRoute.routeKey,
          externalChannelId: "current",
          active: true,
        },
        { routeKey: "removed", externalChannelId: "old", active: true },
        { routeKey: "inactive", externalChannelId: "older", active: false },
      ],
    });

    expect(upserts).toEqual([firstRoute.sourceRef]);
    expect(disables).toEqual([`llmhub:${source.groupId}:removed`]);
    expect(result.removedRouteKeys).toEqual(["removed"]);
  });

  test("HTTP adapter sends the idempotency identity and version contract", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const adapter = createHttpHubRelayAdapter({
      endpoint: "https://relay.example.com/internal/xllm/",
      token: "internal-token",
      fetch: (async (input, init) => {
        calls.push({
          url: String(input),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return Response.json({ id: "channel-42" });
      }) as typeof fetch,
    });
    const firstModel = source.models[0];
    if (!firstModel) throw new Error("Expected a source model");
    const [route] = await buildHubRelayProjection(
      { ...source, models: [firstModel] },
      async (ciphertext) => secrets[ciphertext] ?? "",
    );
    if (!route) throw new Error("Expected a route");

    expect(await adapter.upsertRoute(route)).toEqual({
      externalChannelId: "channel-42",
    });
    await adapter.disableRoute({
      sourceRef: route.sourceRef,
      externalChannelId: "channel-42",
      configVersion: 8,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(
      expect.objectContaining({
        url: `https://relay.example.com/internal/xllm/channels/${encodeURIComponent(route.sourceRef)}`,
        body: expect.objectContaining({
          sourceRef: route.sourceRef,
          configVersion: 7,
          configChecksum: route.configChecksum,
          enabled: true,
          multiplierBps: 7_500,
          models: { "gpt-5": "openai/gpt-5" },
        }),
      }),
    );
    expect(calls[1]?.body).toEqual(
      expect.objectContaining({
        sourceRef: route.sourceRef,
        externalChannelId: "channel-42",
        configVersion: 8,
        enabled: false,
      }),
    );
  });
});
