"use client";

import { useQuery } from "@tanstack/react-query";
import { Waypoints } from "lucide-react";
import { useParams } from "next/navigation";

import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";
import { useTRPC } from "@/lib/trpc/client";

export function Breadcrumb() {
  const params = useParams<{ groupId: string }>();
  const trpc = useTRPC();
  const { data } = useQuery(
    trpc.hub.group.queryOptions({ groupId: params.groupId }),
  );

  return (
    <NavBreadcrumb
      items={[
        {
          type: "link",
          label: "分组管理",
          href: "/radar",
          icon: Waypoints,
        },
        { type: "page", label: data?.name ?? "分组详情" },
      ]}
    />
  );
}
