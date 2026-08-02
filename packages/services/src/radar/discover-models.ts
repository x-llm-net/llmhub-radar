import { and, eq, isNull } from "@openstatus/db";
import { radarPool, radarProvider } from "@openstatus/db/src/schema";

import { requireScope } from "../auth";
import { getReadDb, type ServiceContext } from "../context";
import { NotFoundError, ValidationError } from "../errors";
import { decryptSecret } from "./crypto";
import { discoverOpenAiCompatibleModels } from "./openai-compatible-models";
import {
  DiscoverRadarModelsForPoolInput,
  DiscoverRadarModelsInput,
} from "./schemas";

export { buildModelsUrl } from "./openai-compatible-models";

export async function discoverRadarModels(args: {
  ctx: ServiceContext;
  input: DiscoverRadarModelsInput;
  fetch?: typeof fetch;
}) {
  requireScope(args.ctx, "read");
  const input = DiscoverRadarModelsInput.parse(args.input);
  return discoverOpenAiCompatibleModels({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    fetch: args.fetch,
  });
}

export async function discoverRadarModelsForPool(args: {
  ctx: ServiceContext;
  input: DiscoverRadarModelsForPoolInput;
  fetch?: typeof fetch;
}) {
  requireScope(args.ctx, "read");
  const input = DiscoverRadarModelsForPoolInput.parse(args.input);
  const db = getReadDb(args.ctx);

  const pool = await db
    .select({ id: radarPool.id })
    .from(radarPool)
    .where(
      and(
        eq(radarPool.slug, input.poolSlug),
        eq(radarPool.workspaceId, args.ctx.workspace.id),
        isNull(radarPool.deletedAt),
      ),
    )
    .get();

  if (!pool) throw new NotFoundError("radar_pool", input.poolSlug);

  const providers = await db
    .select()
    .from(radarProvider)
    .where(eq(radarProvider.poolId, pool.id))
    .all();

  if (providers.length === 0) {
    throw new NotFoundError("radar_provider", input.poolSlug);
  }
  if (providers.length > 1) {
    throw new ValidationError(
      "Radar status pages must have exactly one provider.",
    );
  }
  const provider = providers[0];
  if (!provider) throw new NotFoundError("radar_provider", input.poolSlug);

  return discoverRadarModels({
    ctx: args.ctx,
    input: {
      baseUrl:
        input.baseUrlOverride ??
        (await decryptSecret(provider.baseUrlEncrypted)),
      apiKey: input.apiKey,
    },
    fetch: args.fetch,
  });
}
