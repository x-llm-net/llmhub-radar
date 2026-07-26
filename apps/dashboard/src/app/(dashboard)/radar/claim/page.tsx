import { HydrateClient, getQueryClient, trpc } from "@/lib/trpc/server";

import { Client } from "./client";

export default async function Page() {
  const queryClient = getQueryClient();
  await queryClient.prefetchQuery(
    trpc.radar.claimApplications.queryOptions({ limit: 20, offset: 0 }),
  );

  return (
    <HydrateClient>
      <Client />
    </HydrateClient>
  );
}
