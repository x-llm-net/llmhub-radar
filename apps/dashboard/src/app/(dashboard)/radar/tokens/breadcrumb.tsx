"use client";

import { KeyRound } from "lucide-react";

import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";

export function Breadcrumb() {
  return (
    <NavBreadcrumb
      items={[{ type: "page", label: "令牌与订阅", icon: KeyRound }]}
    />
  );
}
