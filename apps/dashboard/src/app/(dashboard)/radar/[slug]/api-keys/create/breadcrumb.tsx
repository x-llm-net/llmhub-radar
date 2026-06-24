"use client";

import { useQuery } from "@tanstack/react-query";
import { Radar } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";

import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";
import { useTRPC } from "@/lib/trpc/client";

export function Breadcrumb() {
  const params = useParams<{ slug: string }>();
  const t = useTranslations("radar");
  const trpc = useTRPC();
  const { data } = useQuery(
    trpc.radar.getPool.queryOptions({ slug: params.slug }),
  );

  return (
    <NavBreadcrumb
      items={[
        { type: "link", label: t("title"), href: "/radar", icon: Radar },
        {
          type: "link",
          label: data?.name ?? t("pool"),
          href: `/radar/${params.slug}`,
        },
        { type: "page", label: t("addTokenProbe") },
      ]}
    />
  );
}
