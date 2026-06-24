"use client";

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@openstatus/ui/components/ui/sidebar";
import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";

function topSegment(url: string) {
  return url.split("/")[1] ?? "";
}

export function NavOverview({
  items,
}: {
  items: {
    name: string;
    url: string;
    icon: LucideIcon;
  }[];
}) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const t = useTranslations("nav");
  const currentTop = topSegment(pathname);
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t("workspace")}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.name}>
            <SidebarMenuButton
              isActive={
                currentTop !== "" && currentTop === topSegment(item.url)
              }
              asChild
              tooltip={item.name}
            >
              <Link
                href={item.url}
                onClick={() => setOpenMobile(false)}
                className="font-commit-mono tracking-tight"
              >
                <item.icon />
                <span>{item.name}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
