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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openstatus/ui/components/ui/dialog";
import { Label } from "@openstatus/ui/components/ui/label";
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
  Handshake,
  History,
  Pencil,
  RadioTower,
  Trash2,
  UserRoundCog,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState } from "react";
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
import {
  RadarOwnerPicker,
  type RadarOwnerCandidate,
} from "@/components/radar/owner-picker";
import { useTRPC } from "@/lib/trpc/client";

type OwnershipPool = {
  id: number;
  name: string;
  ownerUserId: number | null;
  claimable: boolean;
  ownerLabel?: string;
};

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
  const queryClient = useQueryClient();
  const [ownershipPool, setOwnershipPool] = useState<OwnershipPool | null>(
    null,
  );
  const [ownerSelection, setOwnerSelection] = useState("platform");
  const [selectedOwner, setSelectedOwner] =
    useState<RadarOwnerCandidate | null>(null);
  const { data, isLoading } = useQuery(trpc.radar.listPools.queryOptions({}));

  const access = data?.access;
  const pools = useMemo(() => data?.items ?? [], [data?.items]);
  const selectedOwnerAtLimit =
    selectedOwner?.providerLimit != null &&
    selectedOwner.providerUsage >= selectedOwner.providerLimit &&
    selectedOwner.userId !== ownershipPool?.ownerUserId;
  const transferOwnership = useMutation(
    trpc.radar.transferOwnership.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries(trpc.radar.listPools.queryOptions({})),
          queryClient.invalidateQueries({
            queryKey: trpc.radar.ownerCandidates.queryKey(),
          }),
        ]);
        toast.success(t("ownershipUpdated"));
        setOwnershipPool(null);
        setSelectedOwner(null);
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
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );
  const metrics = useMemo(() => {
    const targets = pools.reduce((sum, pool) => sum + pool.targetCount, 0);
    const unhealthy = pools.filter(
      (pool) =>
        pool.worstStatus === "down" ||
        pool.worstStatus === "degraded" ||
        pool.worstStatus === "configuration_error",
    ).length;

    if (access?.isAdmin) {
      return [
        {
          title: t("allProviders"),
          value: String(data?.totalSize ?? 0),
          description: t("allProvidersDescription"),
        },
        {
          title: t("platformManaged"),
          value: String(pools.filter((pool) => pool.claimable).length),
          description: t("claimableDescription"),
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
      ];
    }

    return [
      {
        title: t("monitorPools"),
        value: String(access?.providerUsage ?? pools.length),
        description: t("privatePools"),
      },
      {
        title: t("providerQuota"),
        value:
          access?.providerLimit == null
            ? t("unlimited")
            : `${access.providerUsage}/${access.providerLimit}`,
        description:
          access?.verificationStatus === "verified"
            ? t("verifiedQuota")
            : t("standardQuota"),
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
    ];
  }, [access, data?.totalSize, pools, t]);

  return (
    <SectionGroup>
      <Section>
        <SectionHeaderRow>
          <SectionHeader>
            <div className="flex flex-wrap items-center gap-2">
              <SectionTitle>
                {access?.isAdmin ? t("providerManagement") : t("myProviders")}
              </SectionTitle>
              {access && (
                <Badge variant={access.isAdmin ? "default" : "secondary"}>
                  {access.isAdmin
                    ? t("adminUnlimited")
                    : t("quotaUsed", {
                        used: access.providerUsage,
                        limit: access.providerLimit ?? 0,
                      })}
                </Badge>
              )}
            </div>
            <SectionDescription>
              {access?.isAdmin
                ? t("providerManagementDescription")
                : t("myProvidersDescription")}
            </SectionDescription>
          </SectionHeader>
          {access?.isAdmin && (
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/radar/claim">
                  <Handshake />
                  {t("claimReviewAction")}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/settings/audit-logs">
                  <History />
                  {t("operationHistory")}
                </Link>
              </Button>
            </div>
          )}
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
          <SectionTitle>
            {access?.isAdmin ? t("allProviders") : t("monitorPools")}
          </SectionTitle>
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
                  {access?.isAdmin && (
                    <>
                      <TableHead>{t("owner")}</TableHead>
                      <TableHead>{t("ownership")}</TableHead>
                    </>
                  )}
                  <TableHead>{t("targets")}</TableHead>
                  <TableHead>{t("lastCheck")}</TableHead>
                  <TableHead className="text-right">
                    {commonT("action")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pools.map((pool) => {
                  const canEdit =
                    !access?.isAdmin || pool.ownerUserId === access.userId;

                  return (
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
                      {access?.isAdmin && (
                        <>
                          <TableCell>
                            <div className="max-w-48 space-y-1">
                              <div className="truncate text-sm font-medium">
                                {pool.claimable
                                  ? t("platformOwner")
                                  : pool.owner?.name ||
                                    pool.owner?.email ||
                                    t("ownerUnknown")}
                              </div>
                              {!pool.claimable && pool.owner?.name && (
                                <div className="text-muted-foreground truncate text-xs">
                                  {pool.owner.email}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={pool.claimable ? "secondary" : "outline"}
                            >
                              {pool.claimable
                                ? t("platformManaged")
                                : pool.owner?.verificationStatus === "verified"
                                  ? t("verifiedOwner")
                                  : t("assignedOwner")}
                            </Badge>
                          </TableCell>
                        </>
                      )}
                      <TableCell>{pool.targetCount}</TableCell>
                      <TableCell>
                        {formatDate(pool.lastCheckAt, locale, commonT("never"))}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {access?.isAdmin && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setOwnershipPool({
                                  id: pool.id,
                                  name: pool.name,
                                  ownerUserId: pool.ownerUserId,
                                  claimable: pool.claimable,
                                  ownerLabel: pool.owner
                                    ? pool.owner.name
                                      ? `${pool.owner.name} · ${pool.owner.email}`
                                      : pool.owner.email
                                    : undefined,
                                });
                                setSelectedOwner(null);
                                setOwnerSelection(
                                  pool.claimable || pool.ownerUserId == null
                                    ? "platform"
                                    : String(pool.ownerUserId),
                                );
                              }}
                            >
                              <UserRoundCog className="size-3.5" />
                              {t("ownershipAction")}
                            </Button>
                          )}
                          {canEdit && (
                            <>
                              <Button size="sm" variant="outline" asChild>
                                <Link href={`/radar/${pool.slug}/edit`}>
                                  <Pencil className="size-3.5" />
                                  {t("editPoolShort")}
                                </Link>
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="sm" variant="outline">
                                    <Trash2 className="text-destructive size-3.5" />
                                    {t("deletePoolShort")}
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      {t("deletePoolTitle")}
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      {t("deletePoolDescription", {
                                        name: pool.name,
                                      })}
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>
                                      {commonT("cancel")}
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      className="bg-destructive hover:bg-destructive/90 text-white"
                                      disabled={deletePool.isPending}
                                      onClick={() =>
                                        deletePool.mutate({
                                          poolSlug: pool.slug,
                                        })
                                      }
                                    >
                                      {deletePool.isPending
                                        ? commonT("deleting")
                                        : commonT("delete")}
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          )}
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/radar/${pool.slug}`}>
                              {commonT("open")}
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      {access && !access.isAdmin && (
        <div className="flex flex-col gap-4 rounded-md border border-l-4 border-l-slate-400 bg-slate-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:bg-slate-950/30">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("claimTipTitle")}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("claimTipDescription")}
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href="/radar/claim">
              <Handshake />
              {t("claimTipAction")}
            </Link>
          </Button>
        </div>
      )}

      <Dialog
        open={ownershipPool != null}
        onOpenChange={(open) => {
          if (!open && !transferOwnership.isPending) {
            setOwnershipPool(null);
            setSelectedOwner(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("manageOwnership")}</DialogTitle>
            <DialogDescription>
              {t("manageOwnershipDescription", {
                name: ownershipPool?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="radar-ownership-owner">
              {t("ownershipTarget")}
            </Label>
            <RadarOwnerPicker
              id="radar-ownership-owner"
              value={ownerSelection}
              onValueChange={setOwnerSelection}
              onCandidateChange={setSelectedOwner}
              currentOwnerUserId={ownershipPool?.ownerUserId}
              selectedLabel={ownershipPool?.ownerLabel}
              disabled={transferOwnership.isPending}
            />
            <p className="text-muted-foreground text-xs">
              {ownerSelection === "platform"
                ? t("platformManagedHelp")
                : selectedOwnerAtLimit
                  ? t("selectedOwnerQuotaReached")
                  : t("assignedOwnerHelp")}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOwnershipPool(null)}
              disabled={transferOwnership.isPending}
            >
              {commonT("cancel")}
            </Button>
            <Button
              disabled={
                ownershipPool == null ||
                selectedOwnerAtLimit ||
                transferOwnership.isPending
              }
              onClick={() => {
                if (!ownershipPool) return;
                transferOwnership.mutate({
                  poolId: ownershipPool.id,
                  ownerUserId:
                    ownerSelection === "platform"
                      ? null
                      : Number(ownerSelection),
                });
              }}
            >
              {transferOwnership.isPending
                ? t("savingOwnership")
                : t("saveOwnership")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionGroup>
  );
}
