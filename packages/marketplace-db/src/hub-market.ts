import type { MarketplaceDb } from "./db";
import { listHubModelPrices } from "./hub-pricing";
import { getHubHomepageRankings } from "./hub-rankings";
import { listHubAvailableGroupModels } from "./hub-routing";

const BPS = 10_000n;

function ceilDiv(value: bigint, divisor: bigint) {
  return (value + divisor - 1n) / divisor;
}

function pricePerMillion(
  component: { amountMicros: string; unitSize: number },
  multiplierBps = 10_000,
) {
  const official = ceilDiv(
    BigInt(component.amountMicros),
    BigInt(component.unitSize),
  );
  return ceilDiv(official * BigInt(multiplierBps), BPS).toString();
}

export async function listHubMarketModels(
  db: MarketplaceDb,
  options: { asOf?: Date } = {},
) {
  const asOf = options.asOf ?? new Date();
  const [boards, prices, availableGroupModels] = await Promise.all([
    getHubHomepageRankings(db, { asOf }),
    listHubModelPrices(db, { asOf }),
    listHubAvailableGroupModels(db),
  ]);
  const priceBySlug = new Map(prices.map((model) => [model.slug, model]));
  const availableByGroupModelId = new Map(
    availableGroupModels.map((item) => [item.groupModelId, item]),
  );

  return boards.flatMap((board) => {
    const pricedModel = priceBySlug.get(board.model.slug);
    const input = pricedModel?.price?.components.find(
      (component) => component.component === "input_text",
    );
    const output = pricedModel?.price?.components.find(
      (component) => component.component === "output_text",
    );
    if (!pricedModel || !input || !output) return [];

    const offers = [...board.ranking, ...board.observing].flatMap((row) => {
      const available = availableByGroupModelId.get(row.providerModelId);
      const multiplierBps = row.group.multiplierBps;
      if (!available || multiplierBps === null) return [];
      return [
        {
          groupModelId: row.providerModelId,
          groupId: row.group.id,
          providerName: row.provider.name,
          groupName: row.group.name,
          description: available.description,
          multiplierBps,
          inputPriceMicros: pricePerMillion(input, multiplierBps),
          outputPriceMicros: pricePerMillion(output, multiplierBps),
          availabilityBps: row.availabilityBps,
          firstTokenP50Ms: row.firstTokenP50Ms,
          sampleCount: row.sampleCount,
          currentStatus: row.currentStatus,
          naturalRank: row.naturalRank,
        },
      ];
    });
    if (offers.length === 0) return [];

    return [
      {
        id: pricedModel.id,
        slug: pricedModel.slug,
        vendor: pricedModel.vendor,
        family: pricedModel.family,
        canonicalName: pricedModel.canonicalName,
        displayName: pricedModel.displayName,
        officialInputPriceMicros: pricePerMillion(input),
        officialOutputPriceMicros: pricePerMillion(output),
        offers,
      },
    ];
  });
}
