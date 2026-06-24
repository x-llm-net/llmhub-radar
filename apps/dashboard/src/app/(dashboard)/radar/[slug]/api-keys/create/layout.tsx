import { AppHeader, AppHeaderContent } from "@/components/nav/app-header";
import { AppSidebarTrigger } from "@/components/nav/app-sidebar";
import {
  HydrateClient,
  fetchQueryOrNotFound,
  trpc,
} from "@/lib/trpc/server";

import { Breadcrumb } from "./breadcrumb";

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
      <div>
        <AppHeader>
          <AppHeaderContent>
            <AppSidebarTrigger />
            <Breadcrumb />
          </AppHeaderContent>
        </AppHeader>
        <main className="w-full flex-1">{children}</main>
      </div>
    </HydrateClient>
  );
}
