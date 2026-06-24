"use client";

import { Bot } from "lucide-react";
import { useTranslations } from "next-intl";

import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";

export function Breadcrumb() {
  const t = useTranslations("agents");

  return (
    <NavBreadcrumb
      items={[{ type: "page", label: t("title"), icon: Bot }]}
    />
  );
}
