import { HydrateClient, getQueryClient, trpc } from "@/lib/trpc/server";

import { Client } from "./client";

export default async function Page() {
  const queryClient = getQueryClient();
  await Promise.all([
    queryClient.prefetchQuery(trpc.hub.tokens.queryOptions()),
    queryClient.prefetchQuery(trpc.hub.availableGroups.queryOptions()),
  ]);

  return (
    <HydrateClient>
      <Client />
    </HydrateClient>
  );
}
