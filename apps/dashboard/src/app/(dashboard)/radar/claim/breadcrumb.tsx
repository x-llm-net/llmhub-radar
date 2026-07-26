"use client";

import { Handshake, Radar } from "lucide-react";
import { useTranslations } from "next-intl";

import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";

export function Breadcrumb() {
  const t = useTranslations("radar");

  return (
    <NavBreadcrumb
      items={[
        { type: "link", label: t("title"), href: "/radar", icon: Radar },
        { type: "page", label: t("claimPageTitle"), icon: Handshake },
      ]}
    />
  );
}
