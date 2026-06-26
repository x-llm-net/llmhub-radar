"use client";

import { Cog, KeyRound, User, Users } from "lucide-react";
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
          value: "members",
          label: t("members"),
          icon: Users,
          href: "/settings/members",
        },
        {
          value: "account",
          label: t("account"),
          icon: User,
          href: "/settings/account",
        },
        {
          value: "security",
          label: t("security"),
          icon: KeyRound,
          href: "/settings/security",
        },
      ]}
    />
  );
}
