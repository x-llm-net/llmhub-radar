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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ExternalLink, RadioTower, Rss } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
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
  SectionTitle,
} from "@/components/content/section";
import { getPublicStatusHref } from "@/lib/radar-public-url";
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
  const locale = useLocale();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery(trpc.radar.listPools.queryOptions({}));
  const { data: mySubscriptions, isLoading: isLoadingMySubscriptions } =
    useQuery(trpc.pageSubscriber.listMine.queryOptions());
  const unsubscribeMine = useMutation(
    trpc.pageSubscriber.unsubscribeMine.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.pageSubscriber.listMine.queryKey(),
        });
      },
    }),
  );

  const pools = data?.items ?? [];
  const subscriptions = mySubscriptions ?? [];

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
          <SectionTitle>{t("mySubscriptions")}</SectionTitle>
          <SectionDescription>{t("mySubscriptionsDescription")}</SectionDescription>
        </SectionHeader>

        {isLoadingMySubscriptions ? (
          <EmptyStateContainer className="min-h-32">
            <EmptyStateTitle>{commonT("loading")}</EmptyStateTitle>
          </EmptyStateContainer>
        ) : subscriptions.length === 0 ? (
          <EmptyStateContainer className="min-h-40">
            <div className="border-border bg-muted flex size-8 items-center justify-center rounded-md border">
              <Rss className="size-4" />
            </div>
            <EmptyStateTitle>{t("mySubscriptionsEmpty")}</EmptyStateTitle>
            <EmptyStateDescription>
              {t("mySubscriptionsEmptyDescription")}
            </EmptyStateDescription>
          </EmptyStateContainer>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("table.statusPage")}</TableHead>
                  <TableHead>{t("table.scope")}</TableHead>
                  <TableHead>{t("table.subscriptionStatus")}</TableHead>
                  <TableHead>{t("table.subscribedAt")}</TableHead>
                  <TableHead className="text-right">
                    {commonT("action")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.map((subscription) => {
                  const href = getSubscriptionHref(subscription, locale);
                  return (
                    <TableRow key={subscription.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium">
                            {subscription.pageTitle}
                          </div>
                          <div className="text-muted-foreground font-commit-mono text-xs tracking-tight">
                            /{subscription.pageSlug}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[240px]">
                        <div className="truncate text-sm">
                          {subscription.componentCount === 0
                            ? t("table.allApiKeys")
                            : subscription.components
                                .map((component) => component.name)
                                .join(", ")}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            subscription.acceptedAt ? "secondary" : "outline"
                          }
                        >
                          {subscription.acceptedAt
                            ? t("table.verified")
                            : t("table.pending")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground text-sm">
                          {formatDateTime(subscription.createdAt, locale)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" asChild>
                            <Link href={href} target="_blank">
                              <ExternalLink className="size-3.5" />
                              {t("openStatusPage")}
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={unsubscribeMine.isPending}
                            onClick={() => {
                              const promise = unsubscribeMine.mutateAsync({
                                id: subscription.id,
                              });
                              toast.promise(promise, {
                                loading: t("unsubscribing"),
                                success: t("unsubscribeSuccess"),
                                error: t("unsubscribeFailed"),
                              });
                            }}
                          >
                            {unsubscribeMine.isPending
                              ? t("unsubscribing")
                              : t("unsubscribe")}
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
                            <Link href={`/radar/${pool.slug}/subscribers`}>
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

function formatDateTime(value: Date | string | null, locale: string) {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function getSubscriptionHref(
  subscription: {
    pageSlug: string;
    customDomain: string | null;
  },
  locale: string,
) {
  const publicLocale = locale.toLowerCase().startsWith("zh") ? "zh" : "en";
  const customDomain = subscription.customDomain?.trim();

  if (customDomain) {
    const domain = customDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    return `https://${domain}/${publicLocale}`;
  }

  return getPublicStatusHref(subscription.pageSlug, publicLocale);
}
