"use client";

import type { RouterOutputs } from "@openstatus/api";
import { StatusPageGetInTouchIcon } from "@openstatus/ui/components/blocks/status-page-get-in-touch";
import {
  StatusPageHeader,
  StatusPageHeaderActions,
  StatusPageHeaderBrand,
  StatusPageHeaderBrandButton,
  StatusPageHeaderContent,
  StatusPageHeaderNav,
  StatusPageHeaderNavItem,
} from "@openstatus/ui/components/blocks/status-page-header";
import { Button } from "@openstatus/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@openstatus/ui/components/ui/sheet";
import { cn } from "@openstatus/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Menu, MessageCircleMore } from "lucide-react";
import { useExtracted, useLocale } from "next-intl";
import NextLink from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useState } from "react";

import { Link } from "@/components/common/link";
import {
  type StatusUpdateType,
  StatusUpdates,
} from "@/components/status-page/status-updates";
import { usePathnamePrefix } from "@/hooks/use-pathname-prefix";
import { useTRPC } from "@/lib/trpc/client";

type Page = RouterOutputs["statusPage"]["get"];

function useNav() {
  const t = useExtracted();
  const locale = useLocale();
  const pathname = usePathname();
  const prefix = usePathnamePrefix();

  return [
    {
      key: "status",
      label: t("Status"),
      href: `/${prefix}`,
      isActive: pathname === `/${prefix}`,
    },
    {
      key: "events",
      label: locale === "zh" ? "事件公告" : t("Events"),
      href: `${prefix ? `/${prefix}` : ""}/events`,
      isActive: pathname.startsWith(`${prefix ? `/${prefix}` : ""}/events`),
    },
  ];
}

function getStatusUpdateTypes(page: Page): StatusUpdateType[] {
  if (!page) return [];

  // NOTE: rss or json are not supported because of authentication
  if (page?.accessType === "email-domain") {
    return ["email"] as const;
  }

  // LLMHub Radar treats public subscriber updates as a core v0 feature.
  return ["email", "webhook", "rss", "json"] as const;
}

export function Header({
  className,
  ...props
}: React.ComponentProps<"header">) {
  const t = useExtracted();
  const locale = useLocale();
  const trpc = useTRPC();
  const { domain } = useParams<{ domain: string }>();
  const { data: page } = useQuery({
    ...trpc.statusPage.get.queryOptions({ slug: domain }),
  });
  const prefix = usePathnamePrefix();

  const subscribeMutation = useMutation(
    trpc.statusPage.subscribe.mutationOptions({}),
  );

  return (
    <StatusPageHeader
      className={cn("group-data-[embed=true]/embed:hidden", className)}
      {...props}
    >
      <StatusPageHeaderContent>
        {/* NOTE: same width as the `StatusUpdates` button */}
        <StatusPageHeaderBrand>
          <div className="flex items-center justify-center">
            <StatusPageHeaderBrandButton>
              <Link
                href={page?.homepageUrl || `/${prefix}`}
                target={page?.homepageUrl ? "_blank" : undefined}
                rel={page?.homepageUrl ? "noreferrer" : undefined}
              >
                {page?.icon ? (
                  <img
                    src={page.icon}
                    alt={
                      locale === "zh"
                        ? `${page.title} 状态页`
                        : `${page.title} status page`
                    }
                    className="size-8"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-md border text-xs font-semibold tracking-normal"
                  >
                    LH
                  </span>
                )}
              </Link>
            </StatusPageHeaderBrandButton>
          </div>
        </StatusPageHeaderBrand>
        <NavDesktop className="hidden md:flex" />
        <StatusPageHeaderActions>
          {page?.contactUrl ? (
            <StatusPageGetInTouchIcon>
              <a href={page.contactUrl} target="_blank" rel="noreferrer">
                <MessageCircleMore />
                <span className="sr-only">{t("Get in touch")}</span>
              </a>
            </StatusPageGetInTouchIcon>
          ) : null}
          <StatusUpdates
            types={getStatusUpdateTypes(page)}
            onSubscribe={async (values) => {
              if (values.channelType === "webhook") {
                await subscribeMutation.mutateAsync({
                  slug: domain,
                  ...values,
                });
                return;
              }

              await subscribeMutation.mutateAsync({
                slug: domain,
                locale,
                ...values,
              });
            }}
            page={page}
          />
          <NavMobile className="md:hidden" />
        </StatusPageHeaderActions>
      </StatusPageHeaderContent>
    </StatusPageHeader>
  );
}

function NavDesktop({
  className,
  ...props
}: React.ComponentProps<typeof StatusPageHeaderNav>) {
  const nav = useNav();
  return (
    <StatusPageHeaderNav className={className} {...props}>
      {nav.map((item) => (
        <StatusPageHeaderNavItem key={item.key} isActive={item.isActive}>
          <NextLink href={item.href}>{item.label}</NextLink>
        </StatusPageHeaderNavItem>
      ))}
    </StatusPageHeaderNav>
  );
}

function NavMobile({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  const t = useExtracted();
  const [open, setOpen] = useState(false);
  const nav = useNav();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className={cn("size-8 border", className)}
          {...props}
        >
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="top">
        <SheetHeader className="border-b">
          <SheetTitle>{t("Menu")}</SheetTitle>
        </SheetHeader>
        <div className="px-1 pb-4">
          <ul className="flex flex-col gap-1">
            {nav.map((item) => {
              return (
                <li key={item.key} className="w-full">
                  <Button
                    variant={item.isActive ? "secondary" : "ghost"}
                    onClick={() => setOpen(false)}
                    className="w-full justify-start"
                    size="sm"
                    asChild
                  >
                    <NextLink href={item.href}>{item.label}</NextLink>
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}
