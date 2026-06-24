"use client";

import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";

import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";

export function Breadcrumb() {
  const t = useTranslations("nav");

  return (
    <NavBreadcrumb
      items={[{ type: "page", label: t("notifications"), icon: Bell }]}
    />
  );
}
