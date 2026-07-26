"use client";

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
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
  label,
  items,
}: {
  label?: string;
  items: {
    name: string;
    url?: string;
    icon: LucideIcon;
    badge?: string;
    disabled?: boolean;
  }[];
}) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const t = useTranslations("nav");
  const currentTop = topSegment(pathname);

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label ?? t("mainMenu")}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const content = (
            <>
              <item.icon />
              <span>{item.name}</span>
              {item.badge ? (
                <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
              ) : null}
            </>
          );

          return (
            <SidebarMenuItem key={item.name}>
              <SidebarMenuButton
                isActive={
                  !!item.url &&
                  currentTop !== "" &&
                  currentTop === topSegment(item.url)
                }
                asChild={!item.disabled && !!item.url}
                disabled={item.disabled}
                tooltip={item.name}
                className="font-commit-mono tracking-tight"
              >
                {!item.disabled && item.url ? (
                  <Link href={item.url} onClick={() => setOpenMobile(false)}>
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
