"use client";

import {
  RadarServiceCard,
  type RadarServiceCardRunSlot,
} from "@openstatus/ui/components/blocks/radar-service-card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openstatus/ui/components/ui/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  CircleAlert,
  Clock3,
  Code2,
  ExternalLink,
  KeyRound,
  Megaphone,
  Pencil,
  Plus,
  RadioTower,
  RefreshCw,
  Trash2,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
import { getPublicStatusHref } from "@/lib/radar-public-url";
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
  safeErrorSummary?: string | null;
  httpStatus: number | null;
  success: boolean;
  firstTokenMs: number | null;
  startedAt: Date | string;
};

function formatAvailability(value: number | null | undefined) {
  if (value == null) return "-";
  const percent = Math.round((value / 100) * 100) / 100;
  if (percent >= 100) return "100%";
  return `${percent.toFixed(2)}%`;
}

function availabilityClass(value: number | null | undefined) {
  if (value == null) return "text-muted-foreground";
  if (value >= 9_800) return "text-emerald-600";
  if (value >= 9_000) return "text-emerald-500";
  if (value >= 7_500) return "text-lime-600";
  if (value >= 5_000) return "text-amber-600";
  return "text-red-600";
}

function formatMs(value: number | null | undefined) {
  if (value == null) return "-";
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}s`;
  }
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
  if (successRate < 5_000) {
    return {
      className: "border-red-200 bg-red-50 text-red-700",
      labelKey: "healthUnstable",
    };
  }
  if (successRate < 7_500) {
    return {
      className: "border-amber-200 bg-amber-50 text-amber-700",
      labelKey: "healthAttention",
    };
  }
  if (successRate < 9_000 || (p95 != null && p95 > 15_000)) {
    return {
      className: "border-lime-200 bg-lime-50 text-lime-700",
      labelKey: "healthDegraded",
    };
  }
  if (successRate >= 9_800 && p95 != null && p95 <= 2_000) {
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
  if (isQuotaRun(run)) return "bg-slate-300";
  if (!run.success) return "bg-red-500";
  if (run.firstTokenMs != null && run.firstTokenMs > 15_000)
    return "bg-amber-500";
  if (run.firstTokenMs != null && run.firstTokenMs > 5_000)
    return "bg-emerald-300";
  return "bg-emerald-500";
}

function isQuotaRun(run: RecentRun) {
  const text = `${run.errorType ?? ""} ${run.safeErrorSummary ?? ""}`;
  return /insufficient[_\s-]?quota|insufficient[_\s-]?balance|insufficient account balance|account balance insufficient|not enough balance|no balance|balance is 0|balance exhausted|余额不足|余额为\s*0|可用余额|额度不足|欠费|充值/i.test(
    text,
  );
}

function buildTimelineRuns(
  runs: RecentRun[],
  labels: RadarProbeTooltipLabels,
  locale: string,
): RadarServiceCardRunSlot[] {
  const chronologicalRuns = [...runs].reverse();
  const slots = [
    ...Array(Math.max(60 - chronologicalRuns.length, 0)).fill(null),
    ...chronologicalRuns.slice(-60),
  ] as Array<RecentRun | null>;

  return slots.map((run, index) =>
    run
      ? {
          key: `${new Date(run.startedAt).getTime()}-${index}`,
          errorType: run.errorType ?? "-",
          firstToken: formatMs(run.firstTokenMs),
          httpStatus: run.httpStatus ?? "-",
          result: getProbeResultLabel(run, labels),
          time: formatDateTime(run.startedAt, locale),
          toneClassName: runTone(run),
        }
      : null,
  );
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
  if (value >= 9_000) return t("availabilityVariable");
  if (value >= 7_500) return t("availabilityDegraded");
  if (value >= 5_000) return t("availabilityBelowThreshold");
  return t("availabilityUnstable");
}

function latencyClass(value: number | null | undefined) {
  if (value == null) return "text-muted-foreground";
  if (value > 15_000) return "text-amber-600";
  if (value > 5_000) return "text-emerald-500";
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

export function Client() {
  const params = useParams<{ slug: string }>();
  const t = useTranslations("radar");
  const commonT = useTranslations("common");
  const notificationsT = useTranslations("notifications");
  const locale = useLocale();
  const router = useRouter();
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
  const recheckCredential = useMutation(
    trpc.radar.recheckCredential.mutationOptions({
      onSuccess: async (result) => {
        await queryClient.invalidateQueries(poolQueryOptions);
        if (result.recovered) {
          toast.success(t("recheckRecovered"));
        } else {
          toast.info(t("recheckStillPaused"));
        }
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );
  const deletePool = useMutation(
    trpc.radar.deletePool.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(
          trpc.radar.listPools.queryOptions({}),
        );
        toast.success(t("poolDeleted"));
        router.replace("/radar");
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
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
    const quotaPaused = credential.pauseReason === "insufficient_quota";
    const handoverExpiresAt = credential.handoverExpiresAt
      ? new Date(credential.handoverExpiresAt)
      : null;
    const handoverExpired =
      handoverExpiresAt != null && handoverExpiresAt.getTime() <= Date.now();
    const status = (
      handoverExpired || quotaPaused
        ? "paused"
        : (target?.status?.currentStatus ??
          target?.currentStatus ??
          (credential.enabled ? "unknown" : "paused"))
    ) as Status;

    return {
      credential,
      target,
      status,
      handoverExpiresAt,
      handoverExpired,
      quotaPaused,
    };
  });

  const totalSamples = cards.reduce(
    (sum, card) => sum + (card.target?.stats7d.sampleCount ?? 0),
    0,
  );
  const weightedAvailability =
    totalSamples === 0
      ? null
      : Math.round(
          cards.reduce((sum, card) => {
            const stats = card.target?.stats7d;
            return sum + (stats?.successRate ?? 0) * (stats?.sampleCount ?? 0);
          }, 0) / totalSamples,
        );
  const coveredModels = uniqueModels([
    ...pool.credentials.flatMap((credential) => credential.modelCatalog),
    ...pool.targets.map((target) => target.modelName),
  ]);
  const activeCredentials = cards.filter(
    ({ credential, handoverExpired, quotaPaused }) =>
      credential.enabled && !handoverExpired && !quotaPaused,
  ).length;
  const publicHref = getPublicStatusHref(pool.slug, locale);
  const visibilityLabel = t(
    pool.visibility === "public"
      ? "visibilityPublic"
      : pool.visibility === "unlisted"
        ? "visibilityUnlisted"
        : "visibilityPrivate",
  );
  const operationLinks = [
    {
      title: t("openStatusPage"),
      description: t("openStatusPageDescription"),
      href: publicHref,
      icon: Activity,
      external: true,
    },
    {
      title: t("embed"),
      description: t("embedDescription"),
      href: `/radar/${pool.slug}/embed`,
      icon: Code2,
      external: false,
    },
    {
      title: t("announcements"),
      description: t("announcementsDescription"),
      href: `/radar/${pool.slug}/announcements`,
      icon: Megaphone,
      external: false,
    },
    {
      title: notificationsT("manageSubscribers"),
      description: t("subscriberManagementDescription"),
      href: `/radar/${pool.slug}/subscribers`,
      icon: Users,
      external: false,
    },
  ];

  return (
    <SectionGroup className="max-w-6xl space-y-10">
      <Section id="overview" className="scroll-mt-28">
        <SectionHeaderRow className="items-start sm:items-start">
          <SectionHeader className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <SectionTitle className="text-xl">{pool.name}</SectionTitle>
              <Badge variant="outline">{visibilityLabel}</Badge>
              <Badge variant={pool.publicPoolOptIn ? "secondary" : "outline"}>
                {pool.publicPoolOptIn
                  ? t("publicPoolOptedIn")
                  : t("publicPoolOptedOut")}
              </Badge>
            </div>
            <SectionDescription className="line-clamp-2">
              {pool.description || t("privateMonitoringPool")}
            </SectionDescription>
          </SectionHeader>
          <div className="flex shrink-0 items-center gap-2">
            {pool.homepageUrl ? (
              <Button size="sm" variant="outline" asChild>
                <a href={pool.homepageUrl} target="_blank" rel="noreferrer">
                  {t("providerHomepage")}
                  <ExternalLink className="size-3.5" />
                </a>
              </Button>
            ) : (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/radar/${pool.slug}/edit`}>
                  <Pencil className="size-3.5" />
                  {t("completePublicProfile")}
                </Link>
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="outline"
                  title={t("deletePoolShort")}
                >
                  <Trash2 className="text-destructive size-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("deletePoolTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("deletePoolDescription", { name: pool.name })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{commonT("cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive hover:bg-destructive/90 text-white"
                    disabled={deletePool.isPending}
                    onClick={() => deletePool.mutate({ poolSlug: pool.slug })}
                  >
                    {deletePool.isPending
                      ? commonT("deleting")
                      : commonT("delete")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </SectionHeaderRow>
        <MetricCardGroup className="md:grid-cols-4 lg:grid-cols-4">
          <MetricCard>
            <MetricCardHeader>
              <MetricCardTitle>{t("averageAvailability7d")}</MetricCardTitle>
            </MetricCardHeader>
            <MetricCardValue
              className={availabilityClass(weightedAvailability)}
            >
              {formatAvailability(weightedAvailability)}
            </MetricCardValue>
          </MetricCard>
          <MetricCard>
            <MetricCardHeader>
              <MetricCardTitle>{t("coveredModels")}</MetricCardTitle>
            </MetricCardHeader>
            <MetricCardValue>{coveredModels.length}</MetricCardValue>
          </MetricCard>
          <MetricCard>
            <MetricCardHeader>
              <MetricCardTitle>{t("activeApiKeys")}</MetricCardTitle>
            </MetricCardHeader>
            <MetricCardValue>
              {activeCredentials}/{pool.credentials.length}
            </MetricCardValue>
          </MetricCard>
          <MetricCard variant={unhealthy > 0 ? "warning" : "default"}>
            <MetricCardHeader>
              <MetricCardTitle>{t("needsAttention")}</MetricCardTitle>
            </MetricCardHeader>
            <MetricCardValue>{unhealthy}</MetricCardValue>
          </MetricCard>
        </MetricCardGroup>
      </Section>

      <Section id="performance" className="scroll-mt-28">
        <SectionHeader>
          <SectionTitle>{t("modelPerformance")}</SectionTitle>
          <SectionDescription>
            {t("modelPerformanceDescription")}
          </SectionDescription>
        </SectionHeader>
        {cards.length === 0 ? (
          <EmptyStateContainer className="min-h-32">
            <EmptyStateTitle>{t("noModelPerformance")}</EmptyStateTitle>
            <EmptyStateDescription>
              {t("noTargetsDescription")}
            </EmptyStateDescription>
          </EmptyStateContainer>
        ) : (
          <div className="overflow-x-auto border-y">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("representativeModel")}</TableHead>
                  <TableHead>{t("tokenGroup")}</TableHead>
                  <TableHead>{t("availability7d")}</TableHead>
                  <TableHead>{t("p95Ttft")}</TableHead>
                  <TableHead>{t("samples")}</TableHead>
                  <TableHead className="text-right">
                    {commonT("status")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cards.map(({ credential, target, status }) => {
                  const stats = target?.stats7d;
                  const health = healthTone(
                    status,
                    stats?.successRate ?? null,
                    stats?.p95FirstTokenMs ?? null,
                  );
                  const modelGroup =
                    credential.modelGroup || t("generalFamily");

                  return (
                    <TableRow key={credential.id}>
                      <TableCell>
                        <div className="min-w-44">
                          <p className="font-mono text-sm font-medium">
                            {target?.modelName ?? "-"}
                          </p>
                          <p className="text-muted-foreground mt-1 text-xs">
                            {modelGroup}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">
                        {credential.name}
                      </TableCell>
                      <TableCell
                        className={availabilityClass(stats?.successRate)}
                      >
                        {formatAvailability(stats?.successRate)}
                      </TableCell>
                      <TableCell
                        className={latencyClass(stats?.p95FirstTokenMs)}
                      >
                        {formatMs(stats?.p95FirstTokenMs)}
                      </TableCell>
                      <TableCell>{stats?.sampleCount ?? 0}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className={health.className}>
                          {t(health.labelKey)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section id="probes" className="scroll-mt-28">
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
          <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            {cards.map(
              ({
                credential,
                target,
                status,
                handoverExpiresAt,
                handoverExpired,
                quotaPaused,
              }) => {
                const stats = target?.stats7d;
                const health = healthTone(
                  status,
                  stats?.successRate ?? null,
                  stats?.p95FirstTokenMs ?? null,
                );
                const lastCheckAt =
                  target?.status?.lastCheckAt ?? target?.lastCheckStartedAt;
                const modelGroup = credential.modelGroup || t("generalFamily");
                const interval = formatInterval(target?.intervalSeconds, t);

                return (
                  <RadarServiceCard
                    key={credential.id}
                    className="h-auto"
                    title={credential.name}
                    status={{
                      className: health.className,
                      label: t(health.labelKey),
                    }}
                    actions={
                      <>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title={
                            handoverExpiresAt
                              ? t("replaceHandoverKey")
                              : t("editApiKey")
                          }
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
                      </>
                    }
                    meta={
                      <>
                        <Badge
                          variant="outline"
                          className={`shrink-0 ${modelFamilyTone(modelGroup)}`}
                        >
                          {modelGroup}
                        </Badge>
                        {quotaPaused ? (
                          <Badge variant="outline" className="shrink-0">
                            {t("quotaPauseBadge")}
                          </Badge>
                        ) : null}
                        {handoverExpiresAt ? (
                          <Badge
                            variant={handoverExpired ? "outline" : "secondary"}
                            className="shrink-0"
                          >
                            <Clock3 className="size-3" />
                            {handoverExpired
                              ? t("handoverExpired")
                              : t("handoverRemaining", {
                                  hours: Math.max(
                                    1,
                                    Math.ceil(
                                      (handoverExpiresAt.getTime() -
                                        Date.now()) /
                                        (60 * 60 * 1000),
                                    ),
                                  ),
                                })}
                          </Badge>
                        ) : null}
                        {target?.modelName ? (
                          <span
                            title={target.modelName}
                            className="min-w-0 truncate font-mono text-slate-700 dark:text-slate-300"
                          >
                            {target.modelName}
                          </span>
                        ) : null}
                        {credential.modelCatalog.length > 0 ? (
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {t("modelCatalogCount", {
                              count: uniqueModels(credential.modelCatalog)
                                .length,
                            })}
                          </span>
                        ) : null}
                      </>
                    }
                    notice={
                      handoverExpired ? (
                        <div className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                          <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium">
                              {t("handoverExpiredNoticeTitle")}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-200">
                              {t("handoverExpiredDescription")}
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2 h-7 border-amber-300 bg-white px-2.5 text-xs text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100 dark:hover:bg-amber-900"
                              asChild
                            >
                              <Link
                                href={`/radar/${pool.slug}/api-keys/${credential.id}/edit`}
                              >
                                <KeyRound className="size-3.5" />
                                {t("configureApiKey")}
                              </Link>
                            </Button>
                          </div>
                        </div>
                      ) : quotaPaused ? (
                        <div className="flex items-start gap-2.5 rounded-md border border-slate-200 bg-slate-50 p-3 text-slate-950 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-100">
                          <CircleAlert className="mt-0.5 size-4 shrink-0 text-slate-500 dark:text-slate-400" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium">
                              {t("quotaPauseNoticeTitle")}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
                              {t("quotaPauseDescription")}
                            </p>
                            {credential.nextRecoveryCheckAt ? (
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {t("quotaPauseNextCheck", {
                                  time: formatDateTime(
                                    credential.nextRecoveryCheckAt,
                                    locale,
                                  ),
                                })}
                              </p>
                            ) : null}
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2 h-7 border-slate-300 bg-white px-2.5 text-xs text-slate-900 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
                              disabled={recheckCredential.isPending}
                              onClick={() =>
                                recheckCredential.mutate({
                                  poolSlug: pool.slug,
                                  credentialId: credential.id,
                                })
                              }
                            >
                              <RefreshCw
                                className={`size-3.5 ${
                                  recheckCredential.isPending &&
                                  recheckCredential.variables?.credentialId ===
                                    credential.id
                                    ? "animate-spin"
                                    : ""
                                }`}
                              />
                              {recheckCredential.isPending &&
                              recheckCredential.variables?.credentialId ===
                                credential.id
                                ? t("recheckingCredential")
                                : t("recheckCredential")}
                            </Button>
                          </div>
                        </div>
                      ) : null
                    }
                    metrics={[
                      {
                        label: t("availability7d"),
                        value: formatAvailability(stats?.successRate),
                        hint: availabilityHint(
                          stats?.successRate,
                          stats?.sampleCount,
                          t,
                        ),
                        valueClassName: availabilityClass(stats?.successRate),
                      },
                      {
                        label: t("p50Ttft"),
                        value: formatMs(stats?.p50FirstTokenMs),
                        hint: latencyHint(stats?.p50FirstTokenMs, t),
                        valueClassName: latencyClass(stats?.p50FirstTokenMs),
                      },
                      {
                        label: t("p95Ttft"),
                        value: formatMs(stats?.p95FirstTokenMs),
                        hint: latencyHint(stats?.p95FirstTokenMs, t),
                        valueClassName: latencyClass(stats?.p95FirstTokenMs),
                      },
                    ]}
                    timeline={{
                      recentLabel: t("recentRuns", { count: 60 }),
                      samplesLabel: t("samples7d", {
                        count: stats?.sampleCount ?? 0,
                      }),
                      runs: buildTimelineRuns(
                        target?.recentRuns ?? [],
                        probeTooltipLabels,
                        locale,
                      ),
                      pastLabel: t("past"),
                      nowLabel: t("now"),
                    }}
                    footer={{
                      interval,
                      intervalTitle: `${t("interval")}: ${interval}`,
                      lastCheck: `${t("lastCheck")}: ${formatDateTime(
                        lastCheckAt,
                        locale,
                      )}`,
                    }}
                  />
                );
              },
            )}
          </div>
        )}
      </Section>

      <Section>
        <SectionHeader>
          <SectionTitle>{t("statusAndOperations")}</SectionTitle>
          <SectionDescription>
            {t("statusAndOperationsDescription")}
          </SectionDescription>
        </SectionHeader>
        <div className="grid border-t md:grid-cols-2">
          {operationLinks.map((item) => {
            const Icon = item.icon;
            const content = (
              <>
                <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {item.title}
                  </span>
                  <span className="text-muted-foreground mt-1 line-clamp-2 block text-xs leading-5">
                    {item.description}
                  </span>
                </span>
                <ArrowUpRight className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors" />
              </>
            );
            const className =
              "group flex min-h-24 items-start gap-3 border-b px-2 py-4 transition-colors hover:bg-muted/40 md:odd:border-r md:px-4";

            return item.external ? (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className={className}
              >
                {content}
              </a>
            ) : (
              <Link key={item.href} href={item.href} className={className}>
                {content}
              </Link>
            );
          })}
        </div>
      </Section>
    </SectionGroup>
  );
}
