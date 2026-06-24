"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@openstatus/ui/components/ui/alert-dialog";
import { Badge } from "@openstatus/ui/components/ui/badge";
import { Button } from "@openstatus/ui/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clock,
  ExternalLink,
  Pencil,
  Plus,
  RadioTower,
  Trash2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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

type RecentRun = {
  errorType?: string | null;
  httpStatus: number | null;
  success: boolean;
  firstTokenMs: number | null;
  startedAt: Date | string;
};

function formatAvailability(value: number | null | undefined) {
  if (value == null) return "-";
  return `${(value / 100).toFixed(2)}%`;
}

function availabilityClass(value: number | null | undefined) {
  if (value == null) return "text-muted-foreground";
  if (value >= 9_800) return "text-emerald-600";
  if (value >= 9_500) return "text-lime-600";
  if (value >= 9_000) return "text-amber-600";
  if (value >= 8_500) return "text-orange-600";
  return "text-red-600";
}

function formatMs(value: number | null | undefined) {
  if (value == null) return "-";
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${value}ms`;
}

function formatInterval(
  intervalSeconds: number | null | undefined,
  t: ReturnType<typeof useTranslations>,
) {
  const minutes = Math.max(1, Math.round((intervalSeconds ?? 600) / 60));
  return t("minutes", { minutes });
}

function formatDateTime(
  date: Date | string | null | undefined,
  locale: string,
) {
  if (!date) return "-";
  return new Intl.DateTimeFormat(locale.startsWith("zh") ? "zh-CN" : "en", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function uniqueModels(models: Array<string | null | undefined>) {
  return Array.from(
    new Set(models.filter((model): model is string => Boolean(model))),
  );
}

function getPublicStatusHref(slug: string, locale: string) {
  const publicLocale = locale.startsWith("zh") ? "zh" : "en";
  const origin =
    process.env.NEXT_PUBLIC_STATUS_PAGE_URL ??
    (process.env.NODE_ENV === "development"
      ? "http://localhost:3001"
      : "https://llm-hub.store");
  return `${origin}/${slug}/${publicLocale}`;
}

function modelFamilyTone(modelFamily: string) {
  const normalized = modelFamily.toLowerCase();
  if (normalized.includes("anthropic") || normalized.includes("claude")) {
    return "border-orange-200 bg-orange-50 text-orange-700";
  }
  if (normalized.includes("gemini") || normalized.includes("google")) {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (normalized.includes("openai") || normalized.includes("gpt")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  return "border-violet-200 bg-violet-50 text-violet-700";
}

function healthTone(
  status: Status,
  successRate: number | null,
  p95: number | null,
) {
  if (status === "down" || status === "configuration_error") {
    return {
      className: "border-red-200 bg-red-50 text-red-700",
      labelKey: "healthDown",
    };
  }
  if (status === "paused") {
    return {
      className: "border-slate-200 bg-slate-50 text-slate-600",
      labelKey: "healthPaused",
    };
  }
  if (successRate == null) {
    return {
      className: "border-slate-200 bg-slate-50 text-slate-600",
      labelKey: "healthUnknown",
    };
  }
  if (successRate < 8_500) {
    return {
      className: "border-red-200 bg-red-50 text-red-700",
      labelKey: "healthUnstable",
    };
  }
  if (successRate < 9_800 || (p95 != null && p95 > 5_000)) {
    return {
      className: "border-amber-200 bg-amber-50 text-amber-700",
      labelKey: "healthDegraded",
    };
  }
  if (p95 != null && p95 <= 2_000) {
    return {
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      labelKey: "healthFast",
    };
  }
  return {
    className: "border-lime-200 bg-lime-50 text-lime-700",
    labelKey: "healthNormal",
  };
}

function runTone(run: RecentRun | null) {
  if (!run) return "bg-muted";
  if (!run.success) return "bg-red-500";
  if (run.firstTokenMs != null && run.firstTokenMs > 5_000)
    return "bg-amber-500";
  return "bg-emerald-500";
}

type RadarProbeTooltipLabels = {
  errorType: string;
  firstToken: string;
  httpStatus: string;
  latencyHigh: string;
  latencySlow: string;
  noSample: string;
  probeFailed: string;
  probeSuccess: string;
  result: string;
  timestamp: string;
};

type RadarProbeTooltipState = {
  errorType: string;
  firstToken: string;
  httpStatus: string;
  result: string;
  time: string;
  x: number;
  y: number;
};

function RadarProbeTooltip({ labels }: { labels: RadarProbeTooltipLabels }) {
  const [tooltip, setTooltip] = useState<RadarProbeTooltipState | null>(null);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        setTooltip(null);
        return;
      }

      const bar = target.closest<HTMLElement>("[data-radar-probe]");
      if (!bar) {
        setTooltip(null);
        return;
      }

      const rect = bar.getBoundingClientRect();
      const x = Math.min(
        Math.max(rect.left + rect.width / 2, 140),
        window.innerWidth - 140,
      );

      setTooltip({
        errorType: bar.dataset.probeError || "-",
        firstToken: bar.dataset.probeFirstToken || "-",
        httpStatus: bar.dataset.probeHttp || "-",
        result: bar.dataset.probeResult || labels.noSample,
        time: bar.dataset.probeTime || "-",
        x,
        y: rect.top - 10,
      });
    };

    const handlePointerLeave = () => setTooltip(null);

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerleave", handlePointerLeave);

    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [labels.noSample]);

  if (!tooltip) return null;

  return (
    <div
      className="bg-popover text-popover-foreground pointer-events-none fixed z-50 w-56 rounded-lg border p-3 text-xs shadow-md"
      style={{
        left: tooltip.x,
        top: Math.max(8, tooltip.y),
        transform: "translate(-50%, -100%)",
      }}
    >
      <div className="grid gap-2">
        <ProbeTooltipRow label={labels.timestamp} value={tooltip.time} />
        <ProbeTooltipRow label={labels.result} value={tooltip.result} />
        <ProbeTooltipRow label={labels.firstToken} value={tooltip.firstToken} />
        <ProbeTooltipRow label={labels.httpStatus} value={tooltip.httpStatus} />
        <ProbeTooltipRow label={labels.errorType} value={tooltip.errorType} />
      </div>
    </div>
  );
}

function ProbeTooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-[10px] font-semibold tracking-normal uppercase">
        {label}
      </div>
      <div className="font-mono text-xs">{value}</div>
    </div>
  );
}

function TimelineBars({
  labels,
  locale,
  runs,
}: {
  labels: RadarProbeTooltipLabels;
  locale: string;
  runs: RecentRun[];
}) {
  const chronologicalRuns = [...runs].reverse();
  const bars = [
    ...Array(Math.max(60 - chronologicalRuns.length, 0)).fill(null),
    ...chronologicalRuns.slice(-60),
  ];

  return (
    <div className="flex h-8 min-w-0 items-center gap-0.5">
      {bars.map((run, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-width historical slots.
          key={index}
          data-radar-probe
          data-probe-error={run?.errorType ?? "-"}
          data-probe-first-token={
            run ? formatMs(run.firstTokenMs) : labels.noSample
          }
          data-probe-http={run?.httpStatus ?? "-"}
          data-probe-result={
            run ? getProbeResultLabel(run, labels) : labels.noSample
          }
          data-probe-time={
            run ? formatDateTime(run.startedAt, locale) : labels.noSample
          }
          className={`h-5 min-w-0 flex-1 rounded-sm transition-[height,filter,opacity] hover:h-6 hover:opacity-90 hover:brightness-110 ${runTone(run)}`}
        />
      ))}
    </div>
  );
}

function getProbeResultLabel(run: RecentRun, labels: RadarProbeTooltipLabels) {
  if (!run.success) return run.errorType || labels.probeFailed;
  if (run.firstTokenMs != null && run.firstTokenMs > 15_000)
    return `${labels.probeSuccess} / ${labels.latencyHigh}`;
  if (run.firstTokenMs != null && run.firstTokenMs > 5_000)
    return `${labels.probeSuccess} / ${labels.latencySlow}`;
  return labels.probeSuccess;
}

function availabilityHint(
  value: number | null | undefined,
  sampleCount: number | null | undefined,
  t: ReturnType<typeof useTranslations>,
) {
  if (!sampleCount || value == null) return t("noSamples");
  if (value >= 9_800) return t("availabilityStable");
  if (value >= 9_500) return t("availabilityVariable");
  if (value >= 9_000) return t("availabilityDegraded");
  if (value >= 8_500) return t("availabilityBelowThreshold");
  return t("availabilityUnstable");
}

function latencyClass(value: number | null | undefined) {
  if (value == null) return "text-muted-foreground";
  if (value > 15_000) return "text-red-600";
  if (value > 5_000) return "text-amber-600";
  if (value <= 2_000) return "text-emerald-600";
  return undefined;
}

function latencyHint(
  value: number | null | undefined,
  t: ReturnType<typeof useTranslations>,
) {
  if (value == null) return t("noSamples");
  if (value <= 2_000) return t("latencyFast");
  if (value <= 5_000) return t("latencyNormal");
  if (value <= 15_000) return t("latencySlow");
  return t("latencyHigh");
}

function RadarMetric({
  label,
  value,
  hint,
  valueClassName,
}: {
  label: string;
  value: string;
  hint: string;
  valueClassName?: string;
}) {
  return (
    <div className="bg-muted/20 flex h-24 min-w-0 flex-col justify-between rounded-lg border p-2">
      <div className="text-muted-foreground truncate text-[11px] whitespace-nowrap">
        {label}
      </div>
      <div>
        <RadarMetricValue value={value} valueClassName={valueClassName} />
        <div className="text-muted-foreground mt-2 truncate text-[11px] leading-tight">
          {hint}
        </div>
      </div>
    </div>
  );
}

function RadarMetricValue({
  value,
  valueClassName,
}: {
  value: string;
  valueClassName?: string;
}) {
  const percentValue = value.endsWith("%");

  return (
    <div
      className={`leading-none font-semibold tracking-normal whitespace-nowrap tabular-nums ${
        valueClassName ?? ""
      }`}
    >
      {percentValue ? (
        <>
          <span className="text-xl">{value.slice(0, -1)}</span>
          <span className="text-xs">%</span>
        </>
      ) : (
        <span className="text-xl">{value}</span>
      )}
    </div>
  );
}

export function Client() {
  const params = useParams<{ slug: string }>();
  const t = useTranslations("radar");
  const commonT = useTranslations("common");
  const locale = useLocale();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const poolQueryOptions = trpc.radar.getPool.queryOptions({
    slug: params.slug,
  });
  const { data: pool } = useQuery(poolQueryOptions);
  const deleteCredential = useMutation(
    trpc.radar.deleteCredential.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(poolQueryOptions);
        toast.success(t("apiKeyDeleted"));
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );
  const publicHref = useMemo(
    () => (pool ? getPublicStatusHref(pool.slug, locale) : "#"),
    [pool, locale],
  );
  const probeTooltipLabels = {
    errorType: t("tooltipErrorType"),
    firstToken: t("tooltipFirstToken"),
    httpStatus: t("tooltipHttpStatus"),
    latencyHigh: t("latencyHigh"),
    latencySlow: t("latencySlow"),
    noSample: t("noSamples"),
    probeFailed: t("probeFailed"),
    probeSuccess: t("probeSuccess"),
    result: t("tooltipResult"),
    timestamp: t("tooltipTimestamp"),
  };

  if (!pool) {
    return (
      <SectionGroup>
        <EmptyStateContainer className="min-h-32">
          <EmptyStateTitle>{t("loadingPool")}</EmptyStateTitle>
        </EmptyStateContainer>
      </SectionGroup>
    );
  }

  const defaultProvider = pool.providers[0];
  const targetByCredentialId = new Map(
    pool.targets
      .filter((target) => target.credentialId)
      .map((target) => [target.credentialId, target]),
  );
  const unhealthy = pool.targets.filter(
    (target) =>
      target.currentStatus === "down" ||
      target.currentStatus === "degraded" ||
      target.currentStatus === "configuration_error",
  ).length;
  const cards = pool.credentials.map((credential) => {
    const target = targetByCredentialId.get(credential.id);
    const status = (target?.status?.currentStatus ??
      target?.currentStatus ??
      (credential.enabled ? "unknown" : "paused")) as Status;
    const models = uniqueModels([
      target?.modelName,
      ...(credential.modelCatalog ?? []),
    ]);

    return { credential, target, status, models };
  });

  return (
    <SectionGroup>
      <Section>
        <SectionHeaderRow>
          <SectionHeader>
            <SectionTitle>{pool.name}</SectionTitle>
            <SectionDescription>
              {pool.description || t("privateMonitoringPool")}
            </SectionDescription>
          </SectionHeader>
          <Button size="sm" variant="outline" asChild>
            <Link href={publicHref} target="_blank">
              {t("previewPublicPath")}
              <ExternalLink className="size-3.5" />
            </Link>
          </Button>
        </SectionHeaderRow>
        <MetricCardGroup className="md:grid-cols-4 lg:grid-cols-4">
          <MetricCard>
            <MetricCardHeader>
              <MetricCardTitle>{t("provider")}</MetricCardTitle>
            </MetricCardHeader>
            <MetricCardValue>
              {defaultProvider?.displayName ?? "-"}
            </MetricCardValue>
          </MetricCard>
          <MetricCard>
            <MetricCardHeader>
              <MetricCardTitle>{t("credentials")}</MetricCardTitle>
            </MetricCardHeader>
            <MetricCardValue>{pool.credentials.length}</MetricCardValue>
          </MetricCard>
          <MetricCard>
            <MetricCardHeader>
              <MetricCardTitle>{t("targets")}</MetricCardTitle>
            </MetricCardHeader>
            <MetricCardValue>{pool.targets.length}</MetricCardValue>
          </MetricCard>
          <MetricCard variant={unhealthy > 0 ? "warning" : "default"}>
            <MetricCardHeader>
              <MetricCardTitle>{t("unhealthy")}</MetricCardTitle>
            </MetricCardHeader>
            <MetricCardValue>{unhealthy}</MetricCardValue>
          </MetricCard>
        </MetricCardGroup>
      </Section>

      <Section>
        <SectionHeader>
          <SectionTitle>{t("apiKeyCardsTitle")}</SectionTitle>
          <SectionDescription>{t("apiKeyCardsDescription")}</SectionDescription>
        </SectionHeader>
        <RadarProbeTooltip labels={probeTooltipLabels} />
        {cards.length === 0 ? (
          <EmptyStateContainer className="min-h-40">
            <RadioTower className="text-muted-foreground size-5" />
            <EmptyStateTitle>{t("noTargets")}</EmptyStateTitle>
            <EmptyStateDescription>
              {t("noTargetsDescription")}
            </EmptyStateDescription>
            <Button size="sm" asChild>
              <Link href={`/radar/${pool.slug}/api-keys/create`}>
                <Plus className="size-4" />
                {t("addTokenProbe")}
              </Link>
            </Button>
          </EmptyStateContainer>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {cards.map(({ credential, target, status, models }) => {
              const stats = target?.stats7d;
              const health = healthTone(
                status,
                stats?.successRate ?? null,
                stats?.p95FirstTokenMs ?? null,
              );
              const visibleModels = models.slice(0, 5);
              const hiddenModelCount = Math.max(
                models.length - visibleModels.length,
                0,
              );
              const lastCheckAt =
                target?.status?.lastCheckAt ?? target?.lastCheckStartedAt;
              const providerName = defaultProvider?.displayName ?? pool.name;

              return (
                <div
                  key={credential.id}
                  className="bg-background rounded-lg border p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <h3 className="truncate text-xl font-bold">
                          {credential.name}
                        </h3>
                        <Badge
                          variant="outline"
                          className={`shrink-0 ${modelFamilyTone(
                            credential.modelGroup || t("generalFamily"),
                          )}`}
                        >
                          {credential.modelGroup || t("generalFamily")}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground min-w-0 truncate text-xs">
                        {providerName} · {t("probeModel")}{" "}
                        <span
                          className="font-mono whitespace-nowrap"
                          title={target?.modelName ?? "-"}
                        >
                          {target?.modelName ?? "-"}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Badge variant="outline" className={health.className}>
                        {t(health.labelKey)}
                      </Badge>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title={t("editApiKey")}
                        asChild
                      >
                        <Link
                          href={`/radar/${pool.slug}/api-keys/${credential.id}/edit`}
                        >
                          <Pencil className="size-4" />
                        </Link>
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            title={t("deleteApiKey")}
                          >
                            <Trash2 className="text-destructive size-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {t("deleteApiKeyTitle")}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {t("deleteApiKeyDescription", {
                                name: credential.name,
                              })}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>
                              {commonT("cancel")}
                            </AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive hover:bg-destructive/90 text-white"
                              onClick={() =>
                                deleteCredential.mutate({
                                  poolSlug: pool.slug,
                                  credentialId: credential.id,
                                })
                              }
                            >
                              {deleteCredential.isPending
                                ? commonT("deleting")
                                : commonT("delete")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <RadarMetric
                      label={t("availability7d")}
                      value={formatAvailability(stats?.successRate)}
                      hint={availabilityHint(
                        stats?.successRate,
                        stats?.sampleCount,
                        t,
                      )}
                      valueClassName={availabilityClass(stats?.successRate)}
                    />
                    <RadarMetric
                      label={t("p50Ttft")}
                      value={formatMs(stats?.p50FirstTokenMs)}
                      hint={latencyHint(stats?.p50FirstTokenMs, t)}
                      valueClassName={latencyClass(stats?.p50FirstTokenMs)}
                    />
                    <RadarMetric
                      label={t("p95Ttft")}
                      value={formatMs(stats?.p95FirstTokenMs)}
                      hint={latencyHint(stats?.p95FirstTokenMs, t)}
                      valueClassName={latencyClass(stats?.p95FirstTokenMs)}
                    />
                  </div>

                  <div className="mt-5 border-t pt-4">
                    <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                      <span className="text-muted-foreground">
                        {t("recentRuns", { count: 60 })}
                      </span>
                      <span className="text-muted-foreground">
                        {t("samples7d", { count: stats?.sampleCount ?? 0 })}
                      </span>
                    </div>
                    <TimelineBars
                      labels={probeTooltipLabels}
                      locale={locale}
                      runs={target?.recentRuns ?? []}
                    />
                    <div className="text-muted-foreground mt-1 flex justify-between text-[10px] tracking-normal uppercase">
                      <span>{t("past")}</span>
                      <span>{t("now")}</span>
                    </div>
                  </div>

                  <div className="mt-5 border-t pt-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-muted-foreground text-xs">
                        {t("modelCatalog")}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {t("modelsCount", { count: models.length })}
                      </div>
                    </div>
                    {visibleModels.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {visibleModels.map((model) => (
                          <Badge
                            key={model}
                            variant="outline"
                            className="max-w-full font-mono"
                          >
                            <span className="min-w-0 truncate">{model}</span>
                          </Badge>
                        ))}
                        {hiddenModelCount > 0 ? (
                          <Badge variant="secondary">
                            {t("moreModels", { count: hiddenModelCount })}
                          </Badge>
                        ) : null}
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-sm">
                        {t("noModelCatalog")}
                      </div>
                    )}
                  </div>

                  <div className="text-muted-foreground mt-4 flex items-center justify-between gap-4 border-t pt-3 text-xs">
                    <span
                      className="text-foreground inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap"
                      title={`${t("interval")}: ${formatInterval(
                        target?.intervalSeconds,
                        t,
                      )}`}
                    >
                      <Clock className="text-muted-foreground size-3.5" />
                      {formatInterval(target?.intervalSeconds, t)}
                    </span>
                    <span className="min-w-0 truncate text-right">
                      {t("lastCheck")}: {formatDateTime(lastCheckAt, locale)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </SectionGroup>
  );
}
