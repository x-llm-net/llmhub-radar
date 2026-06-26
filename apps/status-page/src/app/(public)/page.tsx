import type { SearchParams } from "nuqs";

import { getQueryClient, trpc } from "@/lib/trpc/server";

import { Client } from "./client";
import { searchParamsCache } from "./search-params";

const PAGE_SIZE = 12;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const parsed = await searchParamsCache.parse(searchParams);
  const rawOffset = Number(parsed.offset ?? 0);
  const offset = Number.isFinite(rawOffset)
    ? Math.max(0, Math.floor(rawOffset))
    : 0;
  const directory = await getQueryClient().fetchQuery(
    trpc.statusPage.listPublicRadar.queryOptions({
      limit: PAGE_SIZE,
      offset,
    }),
  );

  return <Client directory={directory} offset={offset} />;
}
