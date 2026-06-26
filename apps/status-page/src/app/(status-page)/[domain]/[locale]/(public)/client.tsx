"use client";

import {
  RadarServiceCard,
  type RadarServiceCardRunSlot,
} from "@openstatus/ui/components/blocks/radar-service-card";
import {
  StatusComponent,
  StatusComponentBody,
  StatusComponentDescription,
  StatusComponentFooter,
  StatusComponentHeader,
  StatusComponentHeaderLeft,
  StatusComponentHeaderRight,
  StatusComponentIcon,
  StatusComponentStatus,
  StatusComponentTitle,
  StatusComponentUptime,
  StatusComponentUptimeSkeleton,
} from "@openstatus/ui/components/blocks/status-component";
import {
  Status,
  StatusContent,
  StatusDescription,
  StatusHeader,
  StatusTitle,
} from "@openstatus/ui/components/blocks/status-layout";
import { Badge } from "@openstatus/ui/components/ui/badge";
import { cn } from "@openstatus/ui/lib/utils";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { notFound, useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Link } from "@/components/common/link";
import { useStatusPage } from "@/components/status-page/floating-button";
import {
  StatusBanner,
  StatusBannerContainer,
  StatusBannerContent,
  StatusBannerTabs,
  StatusBannerTabsContent,
  StatusBannerTabsList,
  StatusBannerTabsTrigger,
} from "@/components/status-page/status-banner";
import {
  StatusBar,
  StatusBarSkeleton,
} from "@/components/status-page/status-bar";
import { StatusComponentGroup } from "@/components/status-page/status-component-group";
import {
  StatusEventAffected,
  StatusEventAffectedBadge,
  StatusEventTimelineMaintenance,
  StatusEventTimelineReportUpdate,
} from "@/components/status-page/status-events";
import { useEmbed } from "@/hooks/use-embed";
import { usePathnamePrefix } from "@/hooks/use-pathname-prefix";
import { getStatusPageDescription } from "@/lib/status-page-copy";
import { useTRPC } from "@/lib/trpc/client";

export function Client() {
  const locale = useLocale();
  const prefix = usePathnamePrefix();
  const { domain } = useParams<{ domain: string }>();
  const { cardType, barType, showUptime } = useStatusPage();
  const embed = useEmbed();
  const trpc = useTRPC();

  // NOTE: we cannot use `cardType` and `barType` here because of queryKey changes
  // It wouldn't match the server prefetch keys and we would have to refetch the page here
  const {
    data: pageInitial,
    error,
    isLoading: isPageLoading,
  } = useQuery({
    ...trpc.statusPage.get.queryOptions({
      slug: domain,
    }),
    enabled: !!domain,
  });

  // Handle case where page doesn't exist or query fails
  if (!isPageLoading && (error || !pageInitial)) {
    notFound();
  }

  const componentsVisible =
    !embed.mode || embed.sections.includes("components");

  const hasCustomConfig = pageInitial?.configuration
    ? pageInitial.configuration.type !== barType ||
      pageInitial.configuration.value !== cardType
    : false;

  // NOTE: instead, we use the `enabled` flag to only fetch the page if the configuration differs.
  // Also skip when `components` section is hidden in embed mode — this query only matters there.
  const { data: pageWithCustomConfiguration } = useQuery({
    ...trpc.statusPage.get.queryOptions({
      slug: domain,
      cardType,
      barType,
    }),
    enabled: !!domain && hasCustomConfig && componentsVisible,
  });

  // NOTE: we can prefetch that to avoid loading state
  // NOTE: using skipToken instead of enabled:false to prevent tRPC from including this in a batch request with undefined input
  const { data: uptimeData, isLoading } = useQuery(
    trpc.statusPage.getUptime.queryOptions(
      componentsVisible && pageInitial && pageInitial.pageComponents.length > 0
        ? {
            slug: domain,
            pageComponentIds: pageInitial.pageComponents.map((c) =>
              c.id.toString(),
            ),
            cardType,
            barType,
          }
        : skipToken,
    ),
  );

  // NOTE: we need to filter out the incidents as we don't want to show all of them in the banner - a single one is enough
  // REMINDER: we could move that to the server - but we might wanna have the info of all openEvents actually
  const events = useMemo(() => {
    let hasIncident = false;
    return (
      pageInitial?.openEvents.filter((e) => {
        if (e.type !== "incident") return true;
        if (hasIncident) return false;
        hasIncident = true;
        return true;
      }) ?? []
    );
  }, [pageInitial]);

  if (!pageInitial) return null;

  // REMINDER: if we are using the custom configuration, we need to use the pageWithCustomConfiguration
  const page = pageWithCustomConfiguration ?? pageInitial;
  const radarCopyForLocale = locale === "zh" ? radarCopy.zh : radarCopy.en;
  const radarCards = page.radar
    ? [...page.radar.targets].sort((left, right) => {
        const family = left.modelFamily.localeCompare(right.modelFamily);
        if (family !== 0) return family;
        return left.serviceGroupName.localeCompare(right.serviceGroupName);
      })
    : [];

  return (
    <div className="flex flex-col gap-6">
      <Status variant={page.status}>
        <StatusHeader className="group-data-[hide-title=true]/embed:hidden">
          <StatusTitle>{page.title}</StatusTitle>
          <StatusDescription>
            {getStatusPageDescription(page.description, locale)}
          </StatusDescription>
        </StatusHeader>
        {events.length > 0 ? (
          <StatusContent className="group-data-[hide-banner=true]/embed:hidden">
            <StatusBannerTabs
              defaultValue={`${events[0].type}-${events[0].id}`}
            >
              <StatusBannerTabsList>
                {events.map((e, i) => {
                  return (
                    <StatusBannerTabsTrigger
                      value={`${e.type}-${e.id}`}
                      status={e.status}
                      key={`${e.type}-${e.id}`}
                      className={cn(
                        i === 0 && "rounded-tl-lg",
                        i === events.length - 1 && "rounded-tr-lg",
                      )}
                    >
                      {e.name}
                    </StatusBannerTabsTrigger>
                  );
                })}
              </StatusBannerTabsList>
              {events.map((e) => {
                if (e.type === "report") {
                  const report = page.statusReports.find(
                    (report) => report.id === e.id,
                  );
                  if (!report) return null;
                  const lastUpdate = report.statusReportUpdates.sort(
                    (a, b) => b.date.getTime() - a.date.getTime(),
                  )[0];
                  if (!lastUpdate) return null;
                  return (
                    <StatusBannerTabsContent
                      value={`${e.type}-${e.id}`}
                      key={`${e.type}-${e.id}`}
                    >
                      <Link
                        variant="unstyled"
                        href={`${prefix ? `/${prefix}` : ""}/events/report/${report.id}`}
                        className="rounded-lg"
                      >
                        <StatusBannerContainer status={e.status}>
                          <StatusBannerContent>
                            <StatusEventTimelineReportUpdate
                              report={lastUpdate}
                              withDot={false}
                              isLast={true}
                              withSeparator={false}
                            />
                            {report.statusReportsToPageComponents.length > 0 ? (
                              <StatusEventAffected>
                                {report.statusReportsToPageComponents.map(
                                  (affected) => (
                                    <StatusEventAffectedBadge
                                      key={affected.pageComponent.id}
                                    >
                                      {affected.pageComponent.name}
                                    </StatusEventAffectedBadge>
                                  ),
                                )}
                              </StatusEventAffected>
                            ) : null}
                          </StatusBannerContent>
                        </StatusBannerContainer>
                      </Link>
                    </StatusBannerTabsContent>
                  );
                }
                if (e.type === "maintenance") {
                  const maintenance = page.maintenances.find(
                    (maintenance) => maintenance.id === e.id,
                  );
                  if (!maintenance) return null;
                  return (
                    <StatusBannerTabsContent
                      value={`${e.type}-${e.id}`}
                      key={e.id}
                    >
                      <Link
                        variant="unstyled"
                        href={`${prefix ? `/${prefix}` : ""}/events/maintenance/${maintenance.id}`}
                        className="rounded-lg"
                      >
                        <StatusBannerContainer status={e.status}>
                          <StatusBannerContent>
                            <StatusEventTimelineMaintenance
                              maintenance={maintenance}
                              withDot={false}
                            />
                            {maintenance.maintenancesToPageComponents.length >
                            0 ? (
                              <StatusEventAffected>
                                {maintenance.maintenancesToPageComponents.map(
                                  (affected) => (
                                    <StatusEventAffectedBadge
                                      key={affected.pageComponent.id}
                                    >
                                      {affected.pageComponent.name}
                                    </StatusEventAffectedBadge>
                                  ),
                                )}
                              </StatusEventAffected>
                            ) : null}
                          </StatusBannerContent>
                        </StatusBannerContainer>
                      </Link>
                    </StatusBannerTabsContent>
                  );
                }
                if (e.type === "incident") {
                  return (
                    <StatusBannerTabsContent
                      value={`${e.type}-${e.id}`}
                      key={e.id}
                    >
                      <StatusBanner status={e.status} />
                    </StatusBannerTabsContent>
                  );
                }
                return null;
              })}
            </StatusBannerTabs>
          </StatusContent>
        ) : (
          <StatusBanner
            status={page.status}
            className="group-data-[hide-banner=true]/embed:hidden"
          />
        )}
        {/* NOTE: check what gap feels right */}
        {page.trackers.length > 0 ? (
          <StatusContent className="gap-5 group-data-[hide-components=true]/embed:hidden">
            {page.radar ? (
              <RadarSectionHeader
                title={radarCopyForLocale.stabilityOverviewTitle}
                description={radarCopyForLocale.stabilityOverviewDescription}
              />
            ) : null}
            {page.trackers.map((tracker) => {
              if (tracker.type === "component") {
                const component = tracker.component;
                const { data, uptime } =
                  uptimeData?.find((u) => u.pageComponentId === component.id) ??
                  {};

                return (
                  <ComponentCard
                    key={`component-${component.id}`}
                    name={component.name}
                    description={component.description}
                    status={component.status}
                    data={data}
                    uptime={uptime}
                    showUptime={showUptime}
                    isLoading={isLoading}
                  />
                );
              }

              return (
                <StatusComponentGroup
                  key={`group-${tracker.groupId}`}
                  title={tracker.groupName}
                  status={tracker.status}
                  defaultOpen={tracker.defaultOpen}
                >
                  {tracker.components.map((component) => {
                    const { data, uptime } =
                      uptimeData?.find(
                        (u) => u.pageComponentId === component.id,
                      ) ?? {};

                    return (
                      <ComponentCard
                        key={`component-${component.id}`}
                        name={component.name}
                        description={component.description}
                        status={component.status}
                        data={data}
                        uptime={uptime}
                        showUptime={showUptime}
                        isLoading={isLoading}
                      />
                    );
                  })}
                </StatusComponentGroup>
              );
            })}
          </StatusContent>
        ) : null}
        {page.radar && page.radar.targets.length > 0 ? (
          <StatusContent className="gap-5 group-data-[hide-components=true]/embed:hidden">
            <RadarProbeTooltip copy={radarCopyForLocale} />
            <RadarSectionHeader
              title={radarCopyForLocale.apiKeyDetailsTitle}
              description={radarCopyForLocale.apiKeyDetailsDescription}
            />
            <div className="grid auto-rows-fr gap-4 md:grid-cols-2">
              {radarCards.map((target) => (
                <RadarTargetCard
                  key={target.id}
                  target={target}
                  locale={locale}
                />
              ))}
            </div>
            <RadarCriteria copy={radarCopyForLocale} />
          </StatusContent>
        ) : null}
      </Status>
    </div>
  );
}

function RadarSectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-1">
      <h2 className="text-base font-semibold tracking-normal">{title}</h2>
      <p className="text-muted-foreground text-sm leading-relaxed">
        {description}
      </p>
    </div>
  );
}

type ComponentCardData = NonNullable<Parameters<typeof StatusBar>[0]["data"]>;
type RadarTargetStatus =
  | "unknown"
  | "operational"
  | "degraded"
  | "down"
  | "paused"
  | "configuration_error";

type RadarTarget = {
  id: number;
  providerName: string;
  displayName: string;
  serviceGroupName: string;
  tokenGroupName: string;
  modelFamily: string;
  modelName: string;
  modelCatalog: string[];
  currentStatus: RadarTargetStatus;
  intervalSeconds: number;
  nextCheckAt: Date | null;
  lastCheckAt: Date | null;
  stats7d: {
    sampleCount: number;
    successRate: number | null;
    p50FirstTokenMs: number | null;
    p95FirstTokenMs: number | null;
  };
  sampleCount1h: number;
  sampleCount24h: number;
  successRate1h: number;
  successRate24h: number;
  p50FirstTokenMs: number | null;
  p95FirstTokenMs: number | null;
  recentRuns: Array<{
    id: number;
    startedAt: Date;
    success: boolean;
    httpStatus: number | null;
    errorType: string | null;
    firstTokenMs: number | null;
    totalLatencyMs: number | null;
  }>;
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

function RadarProbeTooltip({
  copy,
}: {
  copy: (typeof radarCopy)["en"] | (typeof radarCopy)["zh"];
}) {
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
        firstToken: bar.dataset.probeFirstToken || "N/A",
        httpStatus: bar.dataset.probeHttp || "N/A",
        result: bar.dataset.probeResult || "-",
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
  }, []);

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
        <ProbeTooltipRow label={copy.tooltipTimestamp} value={tooltip.time} />
        <ProbeTooltipRow label={copy.tooltipResult} value={tooltip.result} />
        <ProbeTooltipRow
          label={copy.tooltipFirstToken}
          value={tooltip.firstToken}
        />
        <ProbeTooltipRow
          label={copy.tooltipHttpStatus}
          value={tooltip.httpStatus}
        />
        <ProbeTooltipRow
          label={copy.tooltipErrorType}
          value={tooltip.errorType}
        />
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

function RadarCriteria({
  copy,
}: {
  copy: (typeof radarCopy)["en"] | (typeof radarCopy)["zh"];
}) {
  return (
    <details className="text-muted-foreground border-t pt-3 text-xs">
      <summary className="hover:text-foreground cursor-pointer font-medium">
        {copy.criteriaTitle}
      </summary>
      <div className="mt-2 grid gap-1.5 leading-relaxed">
        <p>{copy.criteriaOverall}</p>
        <p>{copy.criteriaAvailability}</p>
        <p>{copy.criteriaLatency}</p>
      </div>
    </details>
  );
}

function runTone(run: RadarTarget["recentRuns"][number] | null) {
  if (!run) return "bg-muted";
  if (!run.success) return "bg-red-500";
  if (run.firstTokenMs != null && run.firstTokenMs > 5_000) {
    return "bg-amber-500";
  }
  return "bg-emerald-500";
}

function buildTimelineRuns(
  runs: RadarTarget["recentRuns"],
  copy: (typeof radarCopy)["en"] | (typeof radarCopy)["zh"],
  locale: string,
): RadarServiceCardRunSlot[] {
  const chronologicalRuns = [...runs].reverse();
  const slots = [
    ...Array(Math.max(60 - chronologicalRuns.length, 0)).fill(null),
    ...chronologicalRuns.slice(-60),
  ] as Array<RadarTarget["recentRuns"][number] | null>;

  return slots.map((run) =>
    run
      ? {
          key: run.id,
          errorType: run.errorType ?? "-",
          firstToken: formatMs(run.firstTokenMs),
          httpStatus: run.httpStatus ?? "N/A",
          result: getProbeResultLabel(run, copy),
          time: formatDateTime(run.startedAt, locale),
          toneClassName: runTone(run),
        }
      : null,
  );
}

function RadarTargetCard({
  target,
  locale,
}: {
  target: RadarTarget;
  locale: string;
}) {
  const copy = locale === "zh" ? radarCopy.zh : radarCopy.en;
  const health = radarHealthTone(
    target.currentStatus,
    target.stats7d.successRate,
    target.stats7d.p95FirstTokenMs,
    copy,
  );
  const models = uniqueModels([target.modelName, ...target.modelCatalog]);
  const availabilityHint = getAvailabilityHint(
    target.stats7d.successRate,
    target.stats7d.sampleCount,
    copy,
  );
  const modelFamily = target.modelFamily || copy.otherFamily;
  const interval = formatInterval(target.intervalSeconds, copy);

  return (
    <RadarServiceCard
      title={target.serviceGroupName || target.displayName}
      status={{ className: health.className, label: health.label }}
      meta={
        <>
          <span className="truncate">{target.providerName}</span>
          <Badge
            variant="outline"
            className={cn("shrink-0", modelFamilyTone(modelFamily))}
          >
            {modelFamily}
          </Badge>
          {target.modelName ? (
            <Badge
              variant="outline"
              title={target.modelName}
              className="max-w-44 shrink-0 overflow-hidden border-slate-200 bg-slate-50 font-mono text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
            >
              <span className="min-w-0 truncate">{target.modelName}</span>
            </Badge>
          ) : null}
        </>
      }
      metrics={[
        {
          label: copy.availability7d,
          value: formatAvailability(
            target.stats7d.successRate,
            target.stats7d.sampleCount,
          ),
          hint: availabilityHint,
          valueClassName: availabilityClass(target.stats7d.successRate),
        },
        {
          label: copy.firstTokenP50,
          value: formatMs(target.stats7d.p50FirstTokenMs),
          hint: getLatencyHint(target.stats7d.p50FirstTokenMs, copy),
          valueClassName: latencyClass(target.stats7d.p50FirstTokenMs),
        },
        {
          label: copy.firstTokenP95,
          value: formatMs(target.stats7d.p95FirstTokenMs),
          hint: getLatencyHint(target.stats7d.p95FirstTokenMs, copy),
          valueClassName: latencyClass(target.stats7d.p95FirstTokenMs),
        },
      ]}
      timeline={{
        recentLabel: copy.recentRuns.replace("{count}", "60"),
        samplesLabel: copy.samples7d.replace(
          "{count}",
          String(target.stats7d.sampleCount),
        ),
        runs: buildTimelineRuns(target.recentRuns, copy, locale),
        pastLabel: copy.past,
        nowLabel: copy.now,
      }}
      models={{
        label: copy.modelCatalog,
        countLabel: copy.modelsCount.replace("{count}", String(models.length)),
        emptyLabel: copy.noModelCatalog,
        values: models,
      }}
      footer={{
        interval,
        intervalTitle: `${copy.interval}: ${interval}`,
        lastCheck: `${copy.lastCheck}: ${formatDateTime(
          target.lastCheckAt,
          locale,
        )}`,
      }}
    />
  );
}

function ComponentCard({
  name,
  description,
  status,
  data,
  uptime,
  showUptime,
  isLoading,
}: {
  name: string;
  description?: string | null;
  status: "success" | "degraded" | "error" | "info";
  data?: ComponentCardData;
  uptime?: string;
  showUptime?: boolean;
  isLoading?: boolean;
}) {
  return (
    <StatusComponent variant={status}>
      <StatusComponentHeader>
        <StatusComponentHeaderLeft>
          <StatusComponentTitle>{name}</StatusComponentTitle>
          <StatusComponentDescription>{description}</StatusComponentDescription>
        </StatusComponentHeaderLeft>
        <StatusComponentHeaderRight>
          {showUptime ? (
            <>
              {isLoading ? (
                <StatusComponentUptimeSkeleton />
              ) : (
                <StatusComponentUptime>{uptime}</StatusComponentUptime>
              )}
              <StatusComponentIcon />
            </>
          ) : (
            <StatusComponentStatus />
          )}
        </StatusComponentHeaderRight>
      </StatusComponentHeader>
      <StatusComponentBody>
        {isLoading ? <StatusBarSkeleton /> : <StatusBar data={data ?? []} />}
        <StatusComponentFooter data={data ?? []} isLoading={isLoading} />
      </StatusComponentBody>
    </StatusComponent>
  );
}

function uniqueModels(models: Array<string | null | undefined>) {
  return Array.from(
    new Set(models.filter((model): model is string => Boolean(model))),
  );
}

function formatAvailability(value: number | null, samples: number) {
  if (samples === 0 || value == null) return "N/A";
  const percent = Math.round((value / 100) * 100) / 100;
  if (percent >= 100) return "100%";
  return `${percent.toFixed(2)}%`;
}

function getAvailabilityHint(
  value: number | null,
  samples: number,
  copy: {
    availabilityBelowThreshold: string;
    availabilityDegraded: string;
    availabilityStable: string;
    availabilityUnstable: string;
    availabilityVariable: string;
    noSamples: string;
  },
) {
  if (samples === 0 || value == null) return copy.noSamples;
  if (value >= 9_800) return copy.availabilityStable;
  if (value >= 9_500) return copy.availabilityVariable;
  if (value >= 9_000) return copy.availabilityDegraded;
  if (value >= 8_500) return copy.availabilityBelowThreshold;
  return copy.availabilityUnstable;
}

function availabilityClass(value: number | null) {
  if (value == null) return "text-muted-foreground";
  if (value >= 9_800) return "text-emerald-600";
  if (value >= 9_500) return "text-lime-600";
  if (value >= 9_000) return "text-amber-600";
  if (value >= 8_500) return "text-orange-600";
  return "text-red-600";
}

function latencyClass(value: number | null) {
  if (value == null) return "text-muted-foreground";
  if (value > 15_000) return "text-red-600";
  if (value > 5_000) return "text-amber-600";
  if (value <= 2_000) return "text-emerald-600";
  return undefined;
}

function getLatencyHint(
  value: number | null,
  copy: {
    latencyFast: string;
    latencyHigh: string;
    latencyNormal: string;
    latencySlow: string;
    noSamples: string;
  },
) {
  if (value == null) return copy.noSamples;
  if (value <= 2_000) return copy.latencyFast;
  if (value <= 5_000) return copy.latencyNormal;
  if (value <= 15_000) return copy.latencySlow;
  return copy.latencyHigh;
}

function getProbeResultLabel(
  run: RadarTarget["recentRuns"][number],
  copy: (typeof radarCopy)["en"] | (typeof radarCopy)["zh"],
) {
  if (!run.success) return run.errorType || copy.probeFailed;
  if (run.firstTokenMs != null && run.firstTokenMs > 15_000)
    return `${copy.probeSuccess} / ${copy.latencyHigh}`;
  if (run.firstTokenMs != null && run.firstTokenMs > 5_000)
    return `${copy.probeSuccess} / ${copy.latencySlow}`;
  return copy.probeSuccess;
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

function radarHealthTone(
  status: RadarTargetStatus,
  successRate: number | null,
  p95: number | null,
  copy: (typeof radarCopy)["en"] | (typeof radarCopy)["zh"],
) {
  if (status === "down" || status === "configuration_error") {
    return {
      className: "border-red-200 bg-red-50 text-red-700",
      label: copy.healthDown,
    };
  }
  if (status === "paused") {
    return {
      className: "border-slate-200 bg-slate-50 text-slate-600",
      label: copy.healthPaused,
    };
  }
  if (successRate == null) {
    return {
      className: "border-slate-200 bg-slate-50 text-slate-600",
      label: copy.healthUnknown,
    };
  }
  if (successRate < 8_500) {
    return {
      className: "border-red-200 bg-red-50 text-red-700",
      label: copy.healthUnstable,
    };
  }
  if (successRate < 9_800 || (p95 != null && p95 > 5_000)) {
    return {
      className: "border-amber-200 bg-amber-50 text-amber-700",
      label: copy.healthDegraded,
    };
  }
  if (p95 != null && p95 <= 2_000) {
    return {
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      label: copy.healthFast,
    };
  }
  return {
    className: "border-lime-200 bg-lime-50 text-lime-700",
    label: copy.healthNormal,
  };
}

function formatInterval(
  intervalSeconds: number,
  copy: (typeof radarCopy)["en"] | (typeof radarCopy)["zh"],
) {
  const minutes = Math.max(1, Math.round(intervalSeconds / 60));
  return copy.minutes.replace("{minutes}", String(minutes));
}

function formatMs(value: number | null) {
  if (value == null) return "N/A";
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}s`;
  }
  return `${value}ms`;
}

function formatDateTime(value: Date | null, locale: string) {
  if (!value) return "N/A";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

const radarCopy = {
  en: {
    stabilityOverviewTitle: "45-day stability overview",
    stabilityOverviewDescription:
      "Recent 45-day probe results grouped by API key. Gray means no samples for that day.",
    apiKeyDetailsTitle: "API key details",
    apiKeyDetailsDescription:
      "Current status, probe model, first-token latency, and 7-day availability for each API key.",
    lastCheck: "Last check",
    otherFamily: "Other",
    probeModel: "Probe model",
    success1h: "1h success",
    success24h: "24h success",
    criteriaTitle: "Status criteria",
    criteriaOverall:
      "Overall status: degraded means at least one API key is degraded or unavailable; outage means all active API keys are unavailable.",
    criteriaAvailability:
      "7d availability: >=98% stable; 95-98% slightly variable; 90-95% variable; 85-90% clearly variable; <85% unstable.",
    criteriaLatency:
      "First token: <=2s fast; 2-5s normal; 5-15s slow; >15s high latency.",
    firstTokenP50: "First token P50",
    firstTokenP95: "First token P95",
    probeSuccess: "Probe succeeded",
    probeFailed: "Probe failed",
    tooltipTimestamp: "Timestamp",
    tooltipResult: "Result",
    tooltipFirstToken: "First token",
    tooltipHttpStatus: "HTTP status",
    tooltipErrorType: "Error type",
    noRuns: "No probe runs yet",
    availability7d: "7d availability",
    availabilityStable: "Stable",
    availabilityVariable: "Slightly variable",
    availabilityDegraded: "Variable",
    availabilityBelowThreshold: "Clearly variable",
    availabilityUnstable: "Unstable",
    p50Hint: "Typical feel",
    p95Hint: "Tail risk",
    latencyFast: "Fast",
    latencyNormal: "Normal",
    latencySlow: "Getting slow",
    latencyHigh: "High latency",
    noSamples: "No samples",
    recentRuns: "Last {count} probes",
    samples7d: "{count} valid samples",
    past: "Past",
    now: "Now",
    modelCatalog: "Available models",
    modelsCount: "{count} models",
    moreModels: "+{count} more",
    noModelCatalog: "No model catalog yet",
    nextCheck: "Next check",
    interval: "Interval",
    minutes: "{minutes} min",
    healthUnknown: "Unknown",
    healthFast: "Fast",
    healthNormal: "Normal",
    healthDegraded: "Degraded",
    healthUnstable: "Unstable",
    healthDown: "Down",
    healthPaused: "Paused",
    status: {
      unknown: "Unknown",
      operational: "Operational",
      degraded: "Degraded",
      down: "Down",
      paused: "Paused",
      configuration_error: "Config error",
    },
  },
  zh: {
    stabilityOverviewTitle: "45 \u5929\u7a33\u5b9a\u6027\u6982\u89c8",
    stabilityOverviewDescription:
      "\u6309 API \u5bc6\u94a5\u6c47\u603b\u6700\u8fd1 45 \u5929\u63a2\u6d4b\u7ed3\u679c\uff0c\u7070\u8272\u8868\u793a\u5f53\u5929\u6682\u65e0\u6837\u672c",
    apiKeyDetailsTitle: "API \u5bc6\u94a5\u8be6\u60c5",
    apiKeyDetailsDescription:
      "\u5c55\u793a\u6bcf\u4e2a API \u5bc6\u94a5\u7684\u5f53\u524d\u72b6\u6001\u3001\u63a2\u6d4b\u6a21\u578b\u3001\u9996 token \u65f6\u95f4\u548c\u8fd1 7 \u5929\u53ef\u7528\u6027",
    lastCheck: "最后检查",
    otherFamily: "其他",
    probeModel: "探测模型",
    success1h: "1小时成功率",
    success24h: "24小时成功率",
    criteriaTitle: "判定标准",
    criteriaOverall:
      "整体状态：部分 API 密钥降级或不可用显示服务降级；全部活跃 API 密钥不可用显示服务中断。",
    criteriaAvailability:
      "7 天可用性：≥98% 稳定；95-98% 轻微波动；90-95% 波动；85-90% 明显波动；<85% 不稳定。",
    criteriaLatency: "首 token：≤2s 极速；2-5s 正常；5-15s 偏慢；>15s 高延时。",
    firstTokenP50: "首 token P50",
    firstTokenP95: "首 token P95",
    probeSuccess: "检测成功",
    probeFailed: "检测失败",
    tooltipTimestamp: "检测时间",
    tooltipResult: "结果",
    tooltipFirstToken: "首 token",
    tooltipHttpStatus: "HTTP 状态",
    tooltipErrorType: "错误类型",
    noRuns: "暂无检测记录",
    availability7d: "7 天可用性",
    availabilityStable: "稳定",
    availabilityVariable: "轻微波动",
    availabilityDegraded: "波动",
    availabilityBelowThreshold: "明显波动",
    availabilityUnstable: "不稳定",
    p50Hint: "日常体感",
    p95Hint: "尾部风险",
    latencyFast: "极速",
    latencyNormal: "正常",
    latencySlow: "偏慢",
    latencyHigh: "高延时",
    noSamples: "暂无样本",
    recentRuns: "近 {count} 次探测",
    samples7d: "{count} 个有效样本",
    past: "过去",
    now: "现在",
    modelCatalog: "可用模型",
    modelsCount: "{count} 个模型",
    moreModels: "还有 {count} 个",
    noModelCatalog: "暂无模型目录",
    nextCheck: "下次检测",
    interval: "间隔",
    minutes: "{minutes} 分钟",
    healthUnknown: "未知",
    healthFast: "极速",
    healthNormal: "正常",
    healthDegraded: "波动",
    healthUnstable: "不稳定",
    healthDown: "不可用",
    healthPaused: "暂停",
    status: {
      unknown: "未知",
      operational: "正常",
      degraded: "不稳定",
      down: "不可用",
      paused: "暂停",
      configuration_error: "配置异常",
    },
  },
} as const;
