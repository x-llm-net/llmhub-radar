"use client";

import { ReceiptText } from "lucide-react";

import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";

export function Breadcrumb() {
  return (
    <NavBreadcrumb
      items={[{ type: "page", label: "用量与账单", icon: ReceiptText }]}
    />
  );
}
