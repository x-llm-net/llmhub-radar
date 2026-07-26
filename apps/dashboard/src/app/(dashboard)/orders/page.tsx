import { HydrateClient, getQueryClient, trpc } from "@/lib/trpc/server";

import { Client } from "./client";

export default async function Page() {
  const queryClient = getQueryClient();
  await Promise.all([
    queryClient.prefetchQuery(trpc.radar.verificationOverview.queryOptions()),
    queryClient.prefetchQuery(
      trpc.radar.orders.queryOptions({ limit: 50, offset: 0 }),
    ),
  ]);

  return (
    <HydrateClient>
      <Client />
    </HydrateClient>
  );
}
