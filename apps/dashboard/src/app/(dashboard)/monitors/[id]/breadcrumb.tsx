"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams, usePathname } from "next/navigation";

import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";
import { useTRPC } from "@/lib/trpc/client";

import { MONITOR_TABS } from "./constants";

export function Breadcrumb() {
  const t = useTranslations("monitors");
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const trpc = useTRPC();
  const { data: monitor } = useQuery(
    trpc.monitor.get.queryOptions({ id: Number.parseInt(id) }),
  );

  if (!monitor) return null;

  const segment = pathname.split("/").pop() ?? "";
  const currentTab = MONITOR_TABS.find((tab) => tab.value === segment);
  const tabLabels: Record<string, string> = {
    overview: t("tabs.overview"),
    logs: t("tabs.logs"),
    incidents: t("tabs.incidents"),
    edit: t("tabs.settings"),
  };

  return (
    <NavBreadcrumb
      items={[
        {
          type: "link",
          label: t("list.title"),
          href: "/monitors",
          icon: Activity,
        },
        {
          type: "link",
          label: monitor.name,
          href: `/monitors/${id}/overview`,
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
