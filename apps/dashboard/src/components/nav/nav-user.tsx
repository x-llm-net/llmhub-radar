"use client";

import { localeDetails, locales } from "@openstatus/locales";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@openstatus/ui/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@openstatus/ui/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@openstatus/ui/components/ui/sidebar";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronsUpDown,
  CreditCard,
  Languages,
  Laptop,
  LogOut,
  Moon,
  Sparkles,
  Sun,
  User,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { localeCookieName } from "@/i18n/config";
import { useTRPC } from "@/lib/trpc/client";

export function NavUser() {
  const { isMobile, setOpenMobile } = useSidebar();
  const { theme, setTheme } = useTheme();
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("nav");
  const languageT = useTranslations("language");
  const trpc = useTRPC();
  const { data: workspace } = useQuery(trpc.workspace.get.queryOptions());
  const { data: user } = useQuery(trpc.user.get.queryOptions());
  const showBillingEntries = false;

  if (!user || !workspace) return null;

  const userName = user?.name ?? `${user?.firstName} ${user?.lastName}`.trim();
  const setLocale = (nextLocale: string) => {
    document.cookie = `${localeCookieName}=${nextLocale}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground h-14 rounded-none px-4 ring-inset group-data-[collapsible=icon]:mx-2! group-data-[collapsible=icon]:rounded-lg! group-data-[collapsible=icon]:px-0!"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={user?.photoUrl ?? undefined} alt={userName} />
                <AvatarFallback className="rounded-lg uppercase">
                  {userName.slice(0, 2)}
                </AvatarFallback>
                {/*                   <img
                    src={`https://api.dicebear.com/9.x/glass/svg?seed=${workspace.slug}`}
                    alt="avatar"
                  />
                   */}
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{userName}</span>
                <span className="font-commit-mono truncate text-xs tracking-tight">
                  {user?.email}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage
                    src={user?.photoUrl ?? undefined}
                    alt={userName}
                  />
                  <AvatarFallback className="rounded-lg">
                    {userName.slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{userName}</span>
                  <span className="font-commit-mono truncate text-xs tracking-tight">
                    {user?.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {showBillingEntries && workspace.plan === "free" ? (
              <>
                <DropdownMenuItem asChild>
                  <Link
                    href="/settings/billing"
                    onClick={() => setOpenMobile(false)}
                    className="font-commit-mono tracking-tight"
                  >
                    <Sparkles />
                    {t("upgradeWorkspace")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuGroup className="font-commit-mono tracking-tight">
              <DropdownMenuItem asChild>
                <Link
                  href="/settings/account"
                  onClick={() => setOpenMobile(false)}
                >
                  <User />
                  {t("account")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="[&_svg:not([class*='text-'])]:text-muted-foreground gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
                  {theme === "dark" ? (
                    <Moon />
                  ) : theme === "light" ? (
                    <Sun />
                  ) : (
                    <Laptop />
                  )}
                  {t("theme")}
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent className="font-commit-mono tracking-tight">
                    <DropdownMenuItem onClick={() => setTheme("light")}>
                      <Sun /> {t("themeLight")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTheme("dark")}>
                      <Moon /> {t("themeDark")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTheme("system")}>
                      <Laptop /> {t("themeSystem")}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="[&_svg:not([class*='text-'])]:text-muted-foreground gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
                  <Languages />
                  {languageT("switch")}
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent className="font-commit-mono tracking-tight">
                    {locales.map((item) => (
                      <DropdownMenuItem
                        key={item}
                        onClick={() => setLocale(item)}
                      >
                        <span className="w-5">{localeDetails[item].flag}</span>
                        <span>{localeDetails[item].name}</span>
                        {item === locale ? (
                          <span className="text-muted-foreground ml-auto text-xs">
                            {languageT("current")}
                          </span>
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              {showBillingEntries ? (
                <DropdownMenuItem asChild>
                  <Link
                    href="/settings/billing"
                    onClick={() => setOpenMobile(false)}
                  >
                    <CreditCard />
                    {t("billing")}
                  </Link>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut()}
              className="font-commit-mono tracking-tight"
            >
              <LogOut />
              {t("logOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
