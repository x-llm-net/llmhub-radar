"use client";

import { PanelTop } from "lucide-react";
import { useTranslations } from "next-intl";

import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";

export function Breadcrumb() {
  const t = useTranslations("statusPages");

  return (
    <NavBreadcrumb
      items={[
        {
          type: "link",
          label: t("list.title"),
          href: "/status-pages",
          icon: PanelTop,
        },
        { type: "page", label: t("create.title") },
      ]}
    />
  );
}
