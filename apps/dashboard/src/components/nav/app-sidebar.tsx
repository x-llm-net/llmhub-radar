"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@openstatus/ui/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@openstatus/ui/components/ui/tooltip";
import {
  Bell,
  Cog,
  LayoutGrid,
  Radar,
} from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { Kbd } from "@/components/common/kbd";
import { NavOverview } from "@/components/nav/nav-overview";
import { NavUser } from "@/components/nav/nav-user";
import { WorkspaceSwitcher } from "@/components/nav/workspace-switcher";

const SIDEBAR_KEYBOARD_SHORTCUT = "[";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const t = useTranslations("nav");
  const overview = [
    { name: t("overview"), url: "/overview", icon: LayoutGrid },
    { name: t("radar"), url: "/radar", icon: Radar },
    { name: t("notifications"), url: "/notifications", icon: Bell },
    { name: t("settings"), url: "/settings/general", icon: Cog },
  ];

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="flex h-14 justify-center gap-0 border-b p-0">
        <WorkspaceSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavOverview items={overview} />
      </SidebarContent>
      <SidebarFooter className="flex h-14 flex-col justify-center gap-0 border-t p-0">
        <NavUser />
      </SidebarFooter>
      <SidebarRail aria-label={t("toggleSidebar")} title={t("toggleSidebar")} />
    </Sidebar>
  );
}

export function AppSidebarTrigger() {
  const { toggleSidebar } = useSidebar();
  const t = useTranslations("nav");

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarTrigger aria-label={t("toggleSidebar")} />
        </TooltipTrigger>
        <TooltipContent side="right">
          <p className="mr-px inline-flex items-center">
            {t("toggleSidebar")}{" "}
            <Kbd className="border-muted-foreground bg-primary text-background font-mono">
              ⌘
            </Kbd>
            <Kbd className="border-muted-foreground bg-primary text-background font-mono">
              {SIDEBAR_KEYBOARD_SHORTCUT}
            </Kbd>
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
