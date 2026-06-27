"use client";

import { useQuery } from "@tanstack/react-query";
import { Radar } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams, usePathname } from "next/navigation";

import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";
import { useTRPC } from "@/lib/trpc/client";

export function Breadcrumb() {
  const params = useParams<{ slug: string; credentialId?: string }>();
  const pathname = usePathname();
  const t = useTranslations("radar");
  const notificationsT = useTranslations("notifications");
  const trpc = useTRPC();
  const { data } = useQuery(
    trpc.radar.getPool.queryOptions({ slug: params.slug }),
  );
  const poolName = data?.name ?? t("pool");
  const credential = data?.credentials.find(
    (item) => item.id === Number(params.credentialId),
  );
  const isAnnouncementsPage = pathname.includes("/announcements");
  const isEmbedPage = pathname.endsWith("/embed");
  const isPoolEditPage =
    pathname.endsWith("/edit") && !pathname.includes("/api-keys/");
  const isApiKeyCreatePage = pathname.endsWith("/api-keys/create");
  const isApiKeyEditPage =
    pathname.includes("/api-keys/") && pathname.endsWith("/edit");
  const isSubscribersPage = pathname.endsWith("/subscribers");
  const childLabel = isAnnouncementsPage
    ? t("announcements")
    : isEmbedPage
      ? t("embed")
      : isPoolEditPage
        ? t("editPool")
        : isApiKeyCreatePage
          ? t("addTokenProbe")
          : isApiKeyEditPage
            ? (credential?.name ?? t("editApiKey"))
            : isSubscribersPage
              ? notificationsT("manageSubscribers")
              : null;

  return (
    <NavBreadcrumb
      items={[
        { type: "link", label: t("title"), href: "/radar", icon: Radar },
        childLabel
          ? {
              type: "link",
              label: poolName,
              href: `/radar/${params.slug}`,
            }
          : { type: "page", label: poolName },
        ...(childLabel ? [{ type: "page" as const, label: childLabel }] : []),
      ]}
    />
  );
}
