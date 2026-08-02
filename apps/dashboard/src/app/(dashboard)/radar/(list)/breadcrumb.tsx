"use client";

import { Waypoints } from "lucide-react";

import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";

export function Breadcrumb() {
  return (
    <NavBreadcrumb
      items={[{ type: "page", label: "分组管理", icon: Waypoints }]}
    />
  );
}
