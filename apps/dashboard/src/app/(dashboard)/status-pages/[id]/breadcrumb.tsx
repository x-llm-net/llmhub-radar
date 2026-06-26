"use client";

import { useQuery } from "@tanstack/react-query";
import { Radar } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams, usePathname } from "next/navigation";

import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";
import { useTRPC } from "@/lib/trpc/client";

import { STATUS_PAGE_TABS } from "./constants";

export function Breadcrumb() {
  const t = useTranslations("statusPages");
  const radarT = useTranslations("radar");
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const trpc = useTRPC();
  const { data: statusPage } = useQuery(
    trpc.page.get.queryOptions({ id: Number.parseInt(id) }),
  );
  const { data: radarPools } = useQuery(trpc.radar.listPools.queryOptions({}));

  if (!statusPage) return null;

  const radarPool = radarPools?.items.find(
    (pool) => pool.pageId === statusPage.id,
  );
  const segments = pathname.split("/");
  const currentTab = STATUS_PAGE_TABS.find((tab) =>
    segments.includes(tab.value),
  );
  const tabLabels: Record<string, string> = {
    "status-reports": t("tabs.statusReports"),
    maintenances: t("tabs.maintenances"),
    subscribers: t("tabs.subscribers"),
    components: t("tabs.components"),
    edit: t("tabs.settings"),
  };

  return (
    <NavBreadcrumb
      items={[
        {
          type: "link",
          label: radarT("title"),
          href: "/radar",
          icon: Radar,
        },
        {
          type: "link",
          label: statusPage.title,
          href: `/radar/${radarPool?.slug ?? statusPage.slug}`,
        },
        ...(currentTab
          ? [
              {
                type: "page" as const,
                label: tabLabels[currentTab.value] ?? currentTab.value,
                icon: currentTab.icon,
              },
            ]
          : []),
      ]}
    />
  );
}
