"use client";

import { useQuery } from "@tanstack/react-query";
import { Radar } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams, usePathname } from "next/navigation";

import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";
import { useTRPC } from "@/lib/trpc/client";

export function Breadcrumb() {
  const params = useParams<{ slug: string }>();
  const pathname = usePathname();
  const t = useTranslations("radar");
  const trpc = useTRPC();
  const { data } = useQuery(
    trpc.radar.getPool.queryOptions({ slug: params.slug }),
  );
  const poolName = data?.name ?? t("pool");
  const isAnnouncementsPage = pathname.includes("/announcements");

  return (
    <NavBreadcrumb
      items={[
        { type: "link", label: t("title"), href: "/radar", icon: Radar },
        isAnnouncementsPage
          ? {
              type: "link",
              label: poolName,
              href: `/radar/${params.slug}`,
            }
          : { type: "page", label: poolName },
        ...(isAnnouncementsPage
          ? [{ type: "page" as const, label: t("announcements") }]
          : []),
      ]}
    />
  );
}
