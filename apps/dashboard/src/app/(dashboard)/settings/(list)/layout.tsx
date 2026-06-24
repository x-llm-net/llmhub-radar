import {
  AppHeader,
  AppHeaderActions,
  AppHeaderContent,
} from "@/components/nav/app-header";
import { AppSidebarTrigger } from "@/components/nav/app-sidebar";
import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";
import { getTranslations } from "next-intl/server";

import { NavActions } from "./nav-actions";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("settings.index");

  return (
    <div>
      <AppHeader>
        <AppHeaderContent>
          <AppSidebarTrigger />
          <NavBreadcrumb items={[{ type: "page", label: t("title") }]} />
        </AppHeaderContent>
        <AppHeaderActions>
          <NavActions />
        </AppHeaderActions>
      </AppHeader>
      <main className="w-full flex-1">{children}</main>
    </div>
  );
}
