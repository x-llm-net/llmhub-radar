"use client";

import { Cog, KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";

import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";

export function Breadcrumb() {
  const t = useTranslations("settings");

  return (
    <NavBreadcrumb
      items={[
        {
          type: "link",
          label: t("index.title"),
          icon: Cog,
          href: "/settings/general",
        },
        { type: "page", label: t("tabs.security"), icon: KeyRound },
      ]}
    />
  );
}
