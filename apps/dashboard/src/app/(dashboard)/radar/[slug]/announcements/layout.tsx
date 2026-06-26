import {
  HydrateClient,
  fetchQueryOrNotFound,
  trpc,
} from "@/lib/trpc/server";

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await fetchQueryOrNotFound(trpc.radar.getPool.queryOptions({ slug }));

  return (
    <HydrateClient>
      {children}
    </HydrateClient>
  );
}
