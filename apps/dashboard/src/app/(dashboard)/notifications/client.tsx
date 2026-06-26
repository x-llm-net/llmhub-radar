"use client";

import { Badge } from "@openstatus/ui/components/ui/badge";
import { Button } from "@openstatus/ui/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openstatus/ui/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { Bell, ExternalLink, RadioTower } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import {
  EmptyStateContainer,
  EmptyStateDescription,
  EmptyStateTitle,
} from "@/components/content/empty-state";
import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { useTRPC } from "@/lib/trpc/client";

type Status =
  | "unknown"
  | "operational"
  | "degraded"
  | "down"
  | "paused"
  | "configuration_error";

const statusKey: Record<Status, string> = {
  unknown: "unknown",
  operational: "operational",
  degraded: "degraded",
  down: "down",
  paused: "paused",
  configuration_error: "configurationError",
};

function statusVariant(
  status: Status,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "down" || status === "configuration_error") {
    return "destructive";
  }
  if (status === "operational") return "default";
  if (status === "degraded") return "secondary";
  return "outline";
}

export function Client() {
  const t = useTranslations("notifications");
  const radarT = useTranslations("radar");
  const statusT = useTranslations("status");
  const commonT = useTranslations("common");
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.radar.listPools.queryOptions({}));

  const pools = data?.items ?? [];

  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>{t("title")}</SectionTitle>
          <SectionDescription>{t("description")}</SectionDescription>
        </SectionHeader>
      </Section>

      <Section>
        <SectionHeader>
          <SectionTitle>{t("providerSubscriptions")}</SectionTitle>
          <SectionDescription>
            {t("providerSubscriptionsDescription")}
          </SectionDescription>
        </SectionHeader>

        {isLoading ? (
          <EmptyStateContainer className="min-h-32">
            <EmptyStateTitle>{commonT("loading")}</EmptyStateTitle>
          </EmptyStateContainer>
        ) : pools.length === 0 ? (
          <EmptyStateContainer className="min-h-40">
            <div className="border-border bg-muted flex size-8 items-center justify-center rounded-md border">
              <Bell className="size-4" />
            </div>
            <EmptyStateTitle>{t("empty")}</EmptyStateTitle>
            <EmptyStateDescription>{t("emptyDescription")}</EmptyStateDescription>
            <Button size="sm" asChild>
              <Link href="/radar/create">{radarT("createPool")}</Link>
            </Button>
          </EmptyStateContainer>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("table.provider")}</TableHead>
                  <TableHead>{commonT("status")}</TableHead>
                  <TableHead>{t("table.apiKeys")}</TableHead>
                  <TableHead>{t("table.publicPage")}</TableHead>
                  <TableHead className="text-right">
                    {commonT("action")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pools.map((pool) => (
                  <TableRow key={pool.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-medium">{pool.name}</div>
                        <div className="text-muted-foreground font-commit-mono text-xs tracking-tight">
                          /{pool.slug}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(pool.worstStatus)}>
                        {statusT(statusKey[pool.worstStatus])}
                      </Badge>
                    </TableCell>
                    <TableCell>{pool.targetCount}</TableCell>
                    <TableCell>
                      {pool.pageId ? (
                        <Badge variant="outline">{t("table.ready")}</Badge>
                      ) : (
                        <Badge variant="secondary">
                          {t("table.notReady")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/radar/${pool.slug}`}>
                            <RadioTower className="size-3.5" />
                            {commonT("open")}
                          </Link>
                        </Button>
                        {pool.pageId ? (
                          <Button size="sm" asChild>
                            <Link href={`/status-pages/${pool.pageId}/subscribers`}>
                              <ExternalLink className="size-3.5" />
                              {t("manageSubscribers")}
                            </Link>
                          </Button>
                        ) : (
                          <Button size="sm" disabled>
                            {t("manageSubscribers")}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section>
        <div className="border-border bg-muted/40 rounded-md border p-4">
          <div className="space-y-1">
            <p className="font-medium">{t("scopeTitle")}</p>
            <p className="text-muted-foreground font-commit-mono text-sm tracking-tight">
              {t("scopeDescription")}
            </p>
          </div>
        </div>
      </Section>
    </SectionGroup>
  );
}
