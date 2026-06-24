"use client";

import { Activity } from "lucide-react";
import { useTranslations } from "next-intl";

import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";

export function Breadcrumb() {
  const t = useTranslations("monitors");

  return (
    <NavBreadcrumb
      items={[{ type: "page", label: t("list.title"), icon: Activity }]}
    />
  );
}
