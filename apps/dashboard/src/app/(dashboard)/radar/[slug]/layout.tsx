import {
  AppHeader,
  AppHeaderActions,
  AppHeaderContent,
} from "@/components/nav/app-header";
import { AppSidebarTrigger } from "@/components/nav/app-sidebar";
import {
  HydrateClient,
  fetchQueryOrNotFound,
  trpc,
} from "@/lib/trpc/server";
import { getPublicStatusHref } from "@/lib/radar-public-url";
import { getLocale } from "next-intl/server";

import { Breadcrumb } from "./breadcrumb";
import { NavActions } from "./nav-actions";

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const publicHref = getPublicStatusHref(slug, locale);
  await fetchQueryOrNotFound(
    trpc.radar.getPool.queryOptions({ slug }),
  );

  return (
    <HydrateClient>
      <div>
        <AppHeader>
          <AppHeaderContent>
            <AppSidebarTrigger />
            <Breadcrumb />
          </AppHeaderContent>
          <AppHeaderActions>
            <NavActions publicHref={publicHref} />
          </AppHeaderActions>
        </AppHeader>
        <main className="w-full flex-1">{children}</main>
      </div>
    </HydrateClient>
  );
}
