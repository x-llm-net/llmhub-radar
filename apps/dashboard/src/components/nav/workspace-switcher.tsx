"use client";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@openstatus/ui/components/ui/sidebar";
import { cn } from "@openstatus/ui/lib/utils";

interface WorkspaceSwitcherProps {
  className?: string;
}

export function WorkspaceSwitcher({ className }: WorkspaceSwitcherProps) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          size="lg"
          className={cn(
            "h-14 rounded-none px-4 ring-inset group-data-[collapsible=icon]:mx-2! group-data-[collapsible=icon]:rounded-lg! group-data-[collapsible=icon]:px-0!",
            className,
          )}
        >
          <a href="/overview" aria-label="LLMHub Radar">
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg">
              <img
                src="/llmhub-radar-logo.png"
                alt=""
                className="size-8 object-contain"
                aria-hidden="true"
              />
            </div>
            <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
              <div className="text-foreground truncate font-medium">
                LLMHub Radar
              </div>
              <div className="text-muted-foreground truncate text-xs">
                Provider status monitor
              </div>
            </div>
          </a>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
