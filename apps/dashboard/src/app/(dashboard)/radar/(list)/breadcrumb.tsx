"use client";

import { Store } from "lucide-react";

import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";

export function Breadcrumb() {
  return (
    <NavBreadcrumb items={[{ type: "page", label: "渠道供给", icon: Store }]} />
  );
}
