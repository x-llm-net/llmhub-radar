"use client";

import { Blocks, Cog, CreditCard, Globe, ScanEye, User } from "lucide-react";
import { useTranslations } from "next-intl";

import { NavTabs } from "@/components/nav/nav-tabs";

export function Tabs() {
  const t = useTranslations("settings.tabs");

  return (
    <NavTabs
      items={[
        {
          value: "general",
          label: t("general"),
          icon: Cog,
          href: "/settings/general",
        },
        {
          value: "account",
          label: t("account"),
          icon: User,
          href: "/settings/account",
        },
        {
          value: "billing",
          label: t("billing"),
          icon: CreditCard,
          href: "/settings/billing",
        },
        {
          value: "integrations",
          label: t("integrations"),
          icon: Blocks,
          href: "/settings/integrations",
        },
        {
          value: "private-locations",
          label: t("privateLocations"),
          icon: Globe,
          href: "/settings/private-locations",
        },
        {
          value: "audit-logs",
          label: t("auditLogs"),
          icon: ScanEye,
          href: "/settings/audit-logs",
        },
      ]}
    />
  );
}
