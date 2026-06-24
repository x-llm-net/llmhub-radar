"use client";

import { DiscordIcon } from "@openstatus/icons";
import { GitHubIcon } from "@openstatus/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@openstatus/ui/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@openstatus/ui/components/ui/sidebar";
import {
  Book,
  Braces,
  CalendarClock,
  HelpCircle,
  LifeBuoy,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

import { FormDialogSupportContact } from "@/components/forms/support-contact/dialog";

export function NavHelp() {
  const { isMobile } = useSidebar();
  const t = useTranslations("nav");
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  className="font-commit-mono tracking-tight"
                  tooltip={t("getHelp")}
                >
                  <HelpCircle />
                  <span>{t("getHelp")}</span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                side={isMobile ? "bottom" : "right"}
                align="end"
                sideOffset={4}
              >
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  {t("getHelp")}
                </DropdownMenuLabel>
                <FormDialogSupportContact>
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                    <LifeBuoy />
                    {t("support")}
                  </DropdownMenuItem>
                </FormDialogSupportContact>
                <DropdownMenuItem asChild>
                  <Link
                    href="https://www.openstatus.dev/docs"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Book /> {t("docs")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link
                    href="https://api.openstatus.dev/openapi"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Braces /> {t("apiReference")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link
                    href="https://openstatus.dev/cal"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <CalendarClock /> {t("bookCall")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link
                    href="https://openstatus.dev/discord"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <DiscordIcon />
                    {t("community")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link
                    href="https://openstatus.dev/github"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <GitHubIcon />
                    {t("github")}
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
