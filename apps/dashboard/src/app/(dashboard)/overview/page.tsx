"use client";

import { Badge } from "@openstatus/ui/components/ui/badge";
import { Button } from "@openstatus/ui/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Plus,
  RadioTower,
  Settings,
  TriangleAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo } from "react";

import {
  ActionCard,
  ActionCardDescription,
  ActionCardHeader,
  ActionCardTitle,
} from "@/components/content/action-card";
import { ActionCardGroup } from "@/components/content/action-card";
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
  if (status === "down" || status === "configuration_error") {
    return "destructive";
  }
  if (status === "operational") return "default";
  if (status === "degraded") return "secondary";
  return "outline";
}

function isUnhealthy(status: Status) {
  return (
    status === "down" ||
    status === "degraded" ||
    status === "configuration_error"
  );
}

export default function Page() {
  const t = useTranslations("overview");
  const radarT = useTranslations("radar");
  const statusT = useTranslations("status");
  const commonT = useTranslations("common");
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.radar.listPools.queryOptions({}));

  const pools = data?.items ?? [];
  const summary = useMemo(() => {
    const targetCount = pools.reduce((sum, pool) => sum + pool.targetCount, 0);
    const providerCount = pools.reduce(
      (sum, pool) => sum + pool.providerCount,
      0,
    );
    const publicCount = pools.filter((pool) => pool.publicPoolOptIn).length;
    const unhealthyCount = pools.filter((pool) =>
      isUnhealthy(pool.worstStatus),
    ).length;

    return {
      targetCount,
      providerCount,
      publicCount,
      unhealthyCount,
    };
  }, [pools]);

  const metrics = [
    {
      title: t("providerPages"),
      value: pools.length,
      description: t("providerPagesDescription"),
      icon: RadioTower,
      variant: "default" as const,
    },
    {
      title: t("apiKeys"),
      value: summary.targetCount,
      description: t("apiKeysDescription", {
        providers: summary.providerCount,
      }),
      icon: KeyRound,
      variant: "default" as const,
    },
    {
      title: t("unhealthy"),
      value: summary.unhealthyCount,
      description: t("unhealthyDescription"),
      icon: summary.unhealthyCount > 0 ? TriangleAlert : CheckCircle2,
      variant:
        summary.unhealthyCount > 0
          ? ("warning" as const)
          : ("success" as const),
    },
    {
      title: t("publicPages"),
      value: summary.publicCount,
      description: t("publicPagesDescription"),
      icon: ExternalLink,
      variant: "default" as const,
    },
  ];

  const recentPools = pools.slice(0, 5);

  return (
    <SectionGroup>
      <Section>
        <SectionHeaderRow>
          <SectionHeader>
            <SectionTitle>{t("title")}</SectionTitle>
            <SectionDescription>{t("description")}</SectionDescription>
          </SectionHeader>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href="/notifications">
                <Bell className="size-3.5" />
                {t("subscriptionCta")}
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/radar/create">
                <Plus className="size-3.5" />
                {radarT("createPool")}
              </Link>
            </Button>
          </div>
        </SectionHeaderRow>

        <MetricCardGroup className="md:grid-cols-4 lg:grid-cols-4">
          {metrics.map((metric) => (
            <MetricCard key={metric.title} variant={metric.variant}>
              <MetricCardHeader className="flex items-center justify-between gap-2">
                <MetricCardTitle>{metric.title}</MetricCardTitle>
                <metric.icon className="size-4" />
              </MetricCardHeader>
              <MetricCardValue className="text-2xl">
                {metric.value}
              </MetricCardValue>
              <p className="text-muted-foreground font-commit-mono text-xs tracking-tight">
                {metric.description}
              </p>
            </MetricCard>
          ))}
        </MetricCardGroup>
      </Section>

      <Section>
        <SectionHeader>
          <SectionTitle>{t("recentProviders")}</SectionTitle>
          <SectionDescription>
            {t("recentProvidersDescription")}
          </SectionDescription>
        </SectionHeader>

        {isLoading ? (
          <EmptyStateContainer className="min-h-32">
            <EmptyStateTitle>{commonT("loading")}</EmptyStateTitle>
          </EmptyStateContainer>
        ) : recentPools.length === 0 ? (
          <EmptyStateContainer className="min-h-40">
            <div className="border-border bg-muted flex size-8 items-center justify-center rounded-md border">
              <RadioTower className="size-4" />
            </div>
            <EmptyStateTitle>{t("emptyTitle")}</EmptyStateTitle>
            <EmptyStateDescription>
              {t("emptyDescription")}
            </EmptyStateDescription>
            <Button size="sm" asChild>
              <Link href="/radar/create">{radarT("createPool")}</Link>
            </Button>
          </EmptyStateContainer>
        ) : (
          <div className="divide-border overflow-hidden rounded-md border">
            {recentPools.map((pool) => (
              <Link
                key={pool.id}
                href={`/radar/${pool.slug}`}
                className="hover:bg-muted/50 flex items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0 space-y-1">
                  <div className="truncate font-medium">{pool.name}</div>
                  <div className="text-muted-foreground font-commit-mono truncate text-xs tracking-tight">
                    /{pool.slug} - {pool.targetCount} {t("apiKeyUnit")}
                  </div>
                </div>
                <Badge
                  variant={statusVariant(pool.worstStatus)}
                  className="shrink-0"
                >
                  {statusT(statusKey[pool.worstStatus])}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section>
        <SectionHeader>
          <SectionTitle>{t("nextSteps")}</SectionTitle>
          <SectionDescription>{t("nextStepsDescription")}</SectionDescription>
        </SectionHeader>
        <ActionCardGroup className="md:grid-cols-3">
          <Link href="/radar/create">
            <ActionCard className="h-full">
              <ActionCardHeader>
                <div className="flex items-center gap-2">
                  <RadioTower className="size-4" />
                  <ActionCardTitle>{t("createProviderTitle")}</ActionCardTitle>
                </div>
                <ActionCardDescription>
                  {t("createProviderDescription")}
                </ActionCardDescription>
              </ActionCardHeader>
            </ActionCard>
          </Link>
          <Link href="/radar">
            <ActionCard className="h-full">
              <ActionCardHeader>
                <div className="flex items-center gap-2">
                  <KeyRound className="size-4" />
                  <ActionCardTitle>{t("manageApiKeysTitle")}</ActionCardTitle>
                </div>
                <ActionCardDescription>
                  {t("manageApiKeysDescription")}
                </ActionCardDescription>
              </ActionCardHeader>
            </ActionCard>
          </Link>
          <Link href="/notifications">
            <ActionCard className="h-full">
              <ActionCardHeader>
                <div className="flex items-center gap-2">
                  <Settings className="size-4" />
                  <ActionCardTitle>{t("notificationTitle")}</ActionCardTitle>
                </div>
                <ActionCardDescription>
                  {t("notificationDescription")}
                </ActionCardDescription>
              </ActionCardHeader>
            </ActionCard>
          </Link>
        </ActionCardGroup>
      </Section>
    </SectionGroup>
  );
}
