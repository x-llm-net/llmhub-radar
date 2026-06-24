"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { NavTabs } from "@/components/nav/nav-tabs";

import { STATUS_PAGE_TABS } from "./constants";

export function Tabs() {
  const t = useTranslations("statusPages.tabs");
  const { id } = useParams<{ id: string }>();

  const labels: Record<string, string> = {
    "status-reports": t("statusReports"),
    maintenances: t("maintenances"),
    subscribers: t("subscribers"),
    components: t("components"),
    edit: t("settings"),
  };

  return (
    <NavTabs
      items={STATUS_PAGE_TABS.map((tab) => ({
        ...tab,
        label: labels[tab.value] ?? tab.value,
        href: `/status-pages/${id}/${tab.value}`,
      }))}
    />
  );
}
