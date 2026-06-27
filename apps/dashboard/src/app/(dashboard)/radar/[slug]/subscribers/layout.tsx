import {
  HydrateClient,
  fetchQueryOrNotFound,
  getQueryClient,
  trpc,
} from "@/lib/trpc/server";

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const queryClient = getQueryClient();
  const { slug } = await params;
  const pool = await fetchQueryOrNotFound(
    trpc.radar.getPool.queryOptions({ slug }),
  );

  if (pool.pageId) {
    await Promise.all([
      queryClient.prefetchQuery(
        trpc.pageSubscriber.list.queryOptions({ pageId: pool.pageId }),
      ),
      queryClient.prefetchQuery(trpc.page.get.queryOptions({ id: pool.pageId })),
      queryClient.prefetchQuery(
        trpc.pageComponent.list.queryOptions({ pageId: pool.pageId }),
      ),
    ]);
  }

  return <HydrateClient>{children}</HydrateClient>;
}
