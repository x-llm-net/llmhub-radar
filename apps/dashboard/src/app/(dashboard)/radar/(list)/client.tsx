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
import { Pencil, RadioTower } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo } from "react";

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
  SectionHeaderRow,
  SectionTitle,
} from "@/components/content/section";
import {
  MetricCard,
  MetricCardGroup,
  MetricCardHeader,
  MetricCardTitle,
  MetricCardValue,
} from "@/components/metric/metric-card";
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
  if (status === "down" || status === "configuration_error")
    return "destructive";
  if (status === "operational") return "default";
  if (status === "degraded") return "secondary";
  return "outline";
}

function formatDate(
  date: Date | string | null | undefined,
  locale: string,
  emptyLabel: string,
) {
  if (!date) return emptyLabel;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function Client() {
  const t = useTranslations("radar");
  const statusT = useTranslations("status");
  const commonT = useTranslations("common");
  const locale = useLocale();
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.radar.listPools.queryOptions({}));

  const metrics = useMemo(() => {
    const pools = data?.items ?? [];
    const targets = pools.reduce((sum, pool) => sum + pool.targetCount, 0);
    const publicPages = pools.filter((pool) => pool.publicPoolOptIn).length;
    const unhealthy = pools.filter(
      (pool) =>
        pool.worstStatus === "down" ||
        pool.worstStatus === "degraded" ||
        pool.worstStatus === "configuration_error",
    ).length;
    return [
      {
        title: t("monitorPools"),
        value: String(pools.length),
        description: t("privatePools"),
      },
      {
        title: t("probeTargets"),
        value: String(targets),
        description: t("providerModelChecks"),
      },
      {
        title: t("unhealthy"),
        value: String(unhealthy),
        description: t("needsAttention"),
      },
      {
        title: t("publicPages"),
        value: String(publicPages),
        description: t("publishedOrUnlisted"),
      },
    ];
  }, [data?.items, t]);
  const pools = data?.items ?? [];

  return (
    <SectionGroup>
      <Section>
        <SectionHeaderRow>
          <SectionHeader>
            <SectionTitle>{t("title")}</SectionTitle>
            <SectionDescription>{t("description")}</SectionDescription>
          </SectionHeader>
        </SectionHeaderRow>
        <MetricCardGroup className="md:grid-cols-4 lg:grid-cols-4">
          {metrics.map((metric) => (
            <MetricCard key={metric.title}>
              <MetricCardHeader>
                <MetricCardTitle>{metric.title}</MetricCardTitle>
              </MetricCardHeader>
              <MetricCardValue>{metric.value}</MetricCardValue>
              <p className="text-muted-foreground font-commit-mono text-xs tracking-tight">
                {metric.description}
              </p>
            </MetricCard>
          ))}
        </MetricCardGroup>
      </Section>

      <Section>
        <SectionHeader>
          <SectionTitle>{t("monitorPools")}</SectionTitle>
          <SectionDescription>{t("poolListDescription")}</SectionDescription>
        </SectionHeader>
        {isLoading ? (
          <EmptyStateContainer className="min-h-32">
            <EmptyStateTitle>{t("loadingPools")}</EmptyStateTitle>
          </EmptyStateContainer>
        ) : pools.length === 0 ? (
          <EmptyStateContainer className="min-h-36">
            <div className="border-border bg-muted flex size-8 items-center justify-center rounded-md border">
              <RadioTower className="size-4" />
            </div>
            <EmptyStateTitle>{t("emptyTitle")}</EmptyStateTitle>
            <EmptyStateDescription>
              {t("emptyDescription")}
            </EmptyStateDescription>
          </EmptyStateContainer>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pool")}</TableHead>
                  <TableHead>{commonT("status")}</TableHead>
                  <TableHead>{t("providers")}</TableHead>
                  <TableHead>{t("targets")}</TableHead>
                  <TableHead>{t("lastCheck")}</TableHead>
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
                        <div className="text-muted-foreground font-commit-mono text-xs">
                          /{pool.slug}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(pool.worstStatus)}>
                        {statusT(statusKey[pool.worstStatus])}
                      </Badge>
                    </TableCell>
                    <TableCell>{pool.providerCount}</TableCell>
                    <TableCell>{pool.targetCount}</TableCell>
                    <TableCell>
                      {formatDate(pool.lastCheckAt, locale, commonT("never"))}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/radar/${pool.slug}/edit`}>
                            <Pencil className="size-3.5" />
                            {t("editPoolShort")}
                          </Link>
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/radar/${pool.slug}`}>
                            {commonT("open")}
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </SectionGroup>
  );
}
