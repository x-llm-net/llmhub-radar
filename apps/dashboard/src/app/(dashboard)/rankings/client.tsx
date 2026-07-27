"use client";

import { Badge } from "@openstatus/ui/components/ui/badge";
import { Button } from "@openstatus/ui/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@openstatus/ui/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openstatus/ui/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { ChartNoAxesCombined, ExternalLink, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState } from "react";

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
import {
  getMarketplaceApiOrigin,
  getMarketplaceLeaderboardHref,
} from "@/lib/marketplace-url";
import { useTRPC } from "@/lib/trpc/client";

const ALL = "__all__";

type TrendBucket = {
  startsAt: string;
  availabilityBps: number | null;
  sampleCount: number;
};

type RankingResult = {
  providerModelId: string;
  provider: {
    slug: string;
    name: string;
    logoUrl: string | null;
  };
  providerModelName: string;
  availabilityBps: number | null;
  coverageBps: number;
  sampleCount: number;
  validBucketCount: number;
  currentStatus:
    | "unknown"
    | "normal"
    | "degraded"
    | "down"
    | "configuration_error"
    | "stale";
  lastCheckAt: string | null;
  trend: TrendBucket[];
  grade?: "S" | "A" | "B" | "C" | "D";
  naturalRank?: number;
  eligibilityReason?: string | null;
};

type ProviderRankings = {
  provider: {
    slug: string;
    name: string;
    logoUrl: string | null;
  };
  generatedAt: string | null;
  models: Array<{
    model: {
      slug: string;
      vendor: string;
      family: string;
      displayName: string;
      shortName: string;
      description: string;
    };
    generatedAt: string | null;
    ranking: RankingResult | null;
    observing: RankingResult | null;
  }>;
};

type ProviderRankingsResponse = {
  data: ProviderRankings;
  meta: { minRankingScore: number };
};

type ConsoleRow = {
  provider: ProviderRankings["provider"];
  model: ProviderRankings["models"][number]["model"];
  result: RankingResult;
  ranked: boolean;
};

async function loadProviderRankings(providerSlugs: string[]) {
  const origin = getMarketplaceApiOrigin();
  const results = await Promise.all(
    providerSlugs.map(async (slug) => {
      const response = await fetch(
        `${origin}/v1/providers/${encodeURIComponent(slug)}/rankings`,
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("marketplace_api_unavailable");
      return (await response.json()) as ProviderRankingsResponse;
    }),
  );

  return {
    items: results.filter(
      (result): result is ProviderRankingsResponse => result !== null,
    ),
    missingCount: results.filter((result) => result === null).length,
  };
}

export function Client() {
  const t = useTranslations("rankings");
  const commonT = useTranslations("common");
  const locale = useLocale();
  const trpc = useTRPC();
  const [providerFilter, setProviderFilter] = useState(ALL);
  const [modelFilter, setModelFilter] = useState(ALL);
  const poolsQuery = useQuery(trpc.radar.listPools.queryOptions({}));
  const providerSlugs = useMemo(
    () =>
      [
        ...new Set((poolsQuery.data?.items ?? []).map((pool) => pool.slug)),
      ].sort(),
    [poolsQuery.data?.items],
  );
  const rankingsQuery = useQuery({
    queryKey: ["marketplace-provider-rankings", providerSlugs],
    queryFn: () => loadProviderRankings(providerSlugs),
    enabled: !poolsQuery.isLoading && providerSlugs.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const rows = useMemo<ConsoleRow[]>(() => {
    return (rankingsQuery.data?.items ?? [])
      .flatMap(({ data }) =>
        data.models.flatMap((entry) => {
          const result = entry.ranking ?? entry.observing;
          if (!result) return [];
          return [
            {
              provider: data.provider,
              model: entry.model,
              result,
              ranked: entry.ranking !== null,
            },
          ];
        }),
      )
      .sort(
        (left, right) =>
          Number(right.ranked) - Number(left.ranked) ||
          (left.result.naturalRank ?? Number.MAX_SAFE_INTEGER) -
            (right.result.naturalRank ?? Number.MAX_SAFE_INTEGER) ||
          left.model.displayName.localeCompare(right.model.displayName),
      );
  }, [rankingsQuery.data?.items]);
  const modelOptions = useMemo(
    () =>
      [
        ...new Map(rows.map((row) => [row.model.slug, row.model])).values(),
      ].sort((left, right) =>
        left.displayName.localeCompare(right.displayName),
      ),
    [rows],
  );
  const filteredRows = rows.filter(
    (row) =>
      (providerFilter === ALL || row.provider.slug === providerFilter) &&
      (modelFilter === ALL || row.model.slug === modelFilter),
  );
  const rankedCount = rows.filter((row) => row.ranked).length;
  const observingCount = rows.length - rankedCount;
  const isLoading = poolsQuery.isLoading || rankingsQuery.isLoading;

  return (
    <SectionGroup className="max-w-7xl">
      <Section>
        <SectionHeaderRow>
          <SectionHeader>
            <SectionTitle>{t("title")}</SectionTitle>
            <SectionDescription>{t("description")}</SectionDescription>
          </SectionHeader>
          <Button size="sm" variant="outline" asChild>
            <Link
              href={getMarketplaceLeaderboardHref()}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="size-3.5" />
              {t("openPublicRankings")}
            </Link>
          </Button>
        </SectionHeaderRow>

        <MetricCardGroup className="md:grid-cols-4 lg:grid-cols-4">
          <MetricCard>
            <MetricCardHeader>
              <MetricCardTitle>{t("providers")}</MetricCardTitle>
            </MetricCardHeader>
            <MetricCardValue className="text-2xl">
              {rankingsQuery.data?.items.length ?? 0}
            </MetricCardValue>
            <p className="text-muted-foreground font-commit-mono text-xs tracking-tight">
              {t("providersDescription")}
            </p>
          </MetricCard>
          <MetricCard>
            <MetricCardHeader>
              <MetricCardTitle>{t("models")}</MetricCardTitle>
            </MetricCardHeader>
            <MetricCardValue className="text-2xl">
              {rows.length}
            </MetricCardValue>
            <p className="text-muted-foreground font-commit-mono text-xs tracking-tight">
              {t("modelsDescription")}
            </p>
          </MetricCard>
          <MetricCard variant="success">
            <MetricCardHeader>
              <MetricCardTitle>{t("ranked")}</MetricCardTitle>
            </MetricCardHeader>
            <MetricCardValue className="text-2xl">
              {rankedCount}
            </MetricCardValue>
            <p className="text-muted-foreground font-commit-mono text-xs tracking-tight">
              {t("rankedDescription")}
            </p>
          </MetricCard>
          <MetricCard variant={observingCount > 0 ? "warning" : "default"}>
            <MetricCardHeader>
              <MetricCardTitle>{t("observing")}</MetricCardTitle>
            </MetricCardHeader>
            <MetricCardValue className="text-2xl">
              {observingCount}
            </MetricCardValue>
            <p className="text-muted-foreground font-commit-mono text-xs tracking-tight">
              {t("observingDescription")}
            </p>
          </MetricCard>
        </MetricCardGroup>

        {(rankingsQuery.data?.missingCount ?? 0) > 0 ? (
          <p className="text-muted-foreground font-commit-mono text-xs tracking-tight">
            {t("notSynced", { count: rankingsQuery.data?.missingCount ?? 0 })}
          </p>
        ) : null}
      </Section>

      <Section>
        <SectionHeaderRow>
          <SectionHeader>
            <SectionTitle>{t("detailsTitle")}</SectionTitle>
            <SectionDescription>{t("detailsDescription")}</SectionDescription>
          </SectionHeader>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Select value={providerFilter} onValueChange={setProviderFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <span className="min-w-0 flex-1 truncate text-left">
                  {providerFilter === ALL
                    ? t("allProviders")
                    : (poolsQuery.data?.items.find(
                        (pool) => pool.slug === providerFilter,
                      )?.name ?? providerFilter)}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("allProviders")}</SelectItem>
                {(poolsQuery.data?.items ?? []).map((pool) => (
                  <SelectItem key={pool.slug} value={pool.slug}>
                    {pool.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={modelFilter} onValueChange={setModelFilter}>
              <SelectTrigger className="w-full sm:w-52">
                <span className="min-w-0 flex-1 truncate text-left">
                  {modelFilter === ALL
                    ? t("allModels")
                    : (modelOptions.find((model) => model.slug === modelFilter)
                        ?.displayName ?? modelFilter)}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("allModels")}</SelectItem>
                {modelOptions.map((model) => (
                  <SelectItem key={model.slug} value={model.slug}>
                    {model.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </SectionHeaderRow>

        {isLoading ? (
          <EmptyStateContainer className="min-h-40">
            <EmptyStateTitle>{commonT("loading")}</EmptyStateTitle>
          </EmptyStateContainer>
        ) : poolsQuery.isError || rankingsQuery.isError ? (
          <EmptyStateContainer className="min-h-48">
            <div className="border-border bg-muted flex size-8 items-center justify-center rounded-md border">
              <RefreshCw className="size-4" />
            </div>
            <EmptyStateTitle>{t("unavailableTitle")}</EmptyStateTitle>
            <EmptyStateDescription>
              {t("unavailableDescription")}
            </EmptyStateDescription>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (poolsQuery.isError) void poolsQuery.refetch();
                if (rankingsQuery.isError) void rankingsQuery.refetch();
              }}
            >
              <RefreshCw className="size-3.5" />
              {t("retry")}
            </Button>
          </EmptyStateContainer>
        ) : providerSlugs.length === 0 ? (
          <EmptyStateContainer className="min-h-48">
            <div className="border-border bg-muted flex size-8 items-center justify-center rounded-md border">
              <ChartNoAxesCombined className="size-4" />
            </div>
            <EmptyStateTitle>{t("noProvidersTitle")}</EmptyStateTitle>
            <EmptyStateDescription>
              {t("noProvidersDescription")}
            </EmptyStateDescription>
            <Button size="sm" asChild>
              <Link href="/radar/create">{t("createProvider")}</Link>
            </Button>
          </EmptyStateContainer>
        ) : filteredRows.length === 0 ? (
          <EmptyStateContainer className="min-h-48">
            <EmptyStateTitle>{t("emptyTitle")}</EmptyStateTitle>
            <EmptyStateDescription>
              {t("emptyDescription")}
            </EmptyStateDescription>
          </EmptyStateContainer>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("table.providerModel")}</TableHead>
                  <TableHead>{t("table.availability")}</TableHead>
                  <TableHead className="w-[220px]">
                    {t("table.trend")}
                  </TableHead>
                  <TableHead>{t("table.ranking")}</TableHead>
                  <TableHead>{t("table.coverage")}</TableHead>
                  <TableHead>{t("table.currentStatus")}</TableHead>
                  <TableHead className="text-right">
                    {commonT("action")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow key={row.result.providerModelId}>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-medium">
                          {row.model.displayName}
                        </div>
                        <div className="text-muted-foreground font-commit-mono text-xs tracking-tight">
                          {row.provider.name} · {row.result.providerModelName}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-commit-mono font-medium tracking-tight tabular-nums">
                          {formatPercent(row.result.availabilityBps, locale)}
                        </span>
                        {row.result.grade ? (
                          <Badge variant="outline">{row.result.grade}</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <TrendStrip trend={row.result.trend} locale={locale} />
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Badge variant={row.ranked ? "default" : "outline"}>
                          {row.ranked
                            ? t("rankNumber", {
                                rank: row.result.naturalRank ?? "-",
                              })
                            : t("notQualified")}
                        </Badge>
                        <p className="text-muted-foreground max-w-48 text-xs">
                          {row.ranked
                            ? t("qualified")
                            : eligibilityLabel(row.result, t)}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-commit-mono space-y-1 text-xs tracking-tight tabular-nums">
                        <div>
                          {t("coverageValue", {
                            value: formatPercentValue(
                              row.result.coverageBps,
                              locale,
                            ),
                          })}
                        </div>
                        <div className="text-muted-foreground">
                          {t("sampleValue", { count: row.result.sampleCount })}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(row.result.currentStatus)}>
                        {t(`status.${row.result.currentStatus}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" asChild>
                        <Link
                          href={getMarketplaceLeaderboardHref(row.model.slug)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={t("openModelRanking", {
                            model: row.model.displayName,
                          })}
                          title={t("openModelRanking", {
                            model: row.model.displayName,
                          })}
                        >
                          <ExternalLink className="size-4" />
                        </Link>
                      </Button>
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

function statusVariant(status: RankingResult["currentStatus"]) {
  if (status === "down" || status === "configuration_error") {
    return "destructive" as const;
  }
  if (status === "normal") return "default" as const;
  if (status === "degraded") return "secondary" as const;
  return "outline" as const;
}

function formatPercent(value: number | null, locale: string) {
  if (value === null) return "-";
  return `${formatPercentValue(value, locale)}%`;
}

function formatPercentValue(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

function eligibilityLabel(
  result: RankingResult,
  t: ReturnType<typeof useTranslations<"rankings">>,
) {
  switch (result.eligibilityReason) {
    case "no_scoreable_samples":
      return t("eligibility.noSamples");
    case "insufficient_samples":
      return t("eligibility.samples", { count: result.sampleCount });
    case "configuration_error":
      return t("eligibility.configurationError");
    case "stale":
      return t("eligibility.stale");
    default:
      return t("eligibility.pending");
  }
}

function TrendStrip({
  trend,
  locale,
}: {
  trend: TrendBucket[];
  locale: string;
}) {
  return (
    <div className="flex h-5 w-full gap-px" aria-label="7 day trend">
      {trend.map((bucket) => (
        <span
          key={bucket.startsAt}
          className={`min-w-0 flex-1 rounded-[2px] ${trendColor(
            bucket.availabilityBps,
          )}`}
          title={`${new Intl.DateTimeFormat(locale, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
          }).format(new Date(bucket.startsAt))} · ${formatPercent(
            bucket.availabilityBps,
            locale,
          )}`}
        />
      ))}
    </div>
  );
}

function trendColor(availabilityBps: number | null) {
  if (availabilityBps === null) return "bg-muted";
  if (availabilityBps >= 9_800) return "bg-emerald-600";
  if (availabilityBps >= 9_000) return "bg-emerald-300";
  if (availabilityBps >= 7_500) return "bg-lime-400";
  if (availabilityBps >= 5_000) return "bg-amber-400";
  return "bg-red-500";
}
