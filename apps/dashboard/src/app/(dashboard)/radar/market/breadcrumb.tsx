"use client";

import { ShoppingBag } from "lucide-react";

import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";

export function Breadcrumb() {
  return (
    <NavBreadcrumb
      items={[{ type: "page", label: "模型市场", icon: ShoppingBag }]}
    />
  );
}
