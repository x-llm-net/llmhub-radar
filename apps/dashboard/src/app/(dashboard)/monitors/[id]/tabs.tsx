"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { NavTabs } from "@/components/nav/nav-tabs";

import { MONITOR_TABS } from "./constants";

export function Tabs() {
  const t = useTranslations("monitors.tabs");
  const { id } = useParams<{ id: string }>();
  const labels: Record<string, string> = {
    overview: t("overview"),
    logs: t("logs"),
    incidents: t("incidents"),
    edit: t("settings"),
  };

  return (
    <NavTabs
      items={MONITOR_TABS.map((tab) => ({
        ...tab,
        label: labels[tab.value] ?? tab.value,
        href: `/monitors/${id}/${tab.value}`,
      }))}
    />
  );
}
