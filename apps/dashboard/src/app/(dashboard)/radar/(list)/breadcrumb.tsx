"use client";

import { Radar } from "lucide-react";
import { useTranslations } from "next-intl";

import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";

export function Breadcrumb() {
  const t = useTranslations("radar");

  return (
    <NavBreadcrumb items={[{ type: "page", label: t("title"), icon: Radar }]} />
  );
}
