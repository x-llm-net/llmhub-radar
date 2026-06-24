"use client";

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { Bot, List, Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Note, NoteButton } from "@/components/common/note";
import {
  EmptyStateContainer,
  EmptyStateTitle,
} from "@/components/content/empty-state";
import {
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { Section } from "@/components/content/section";
import { useIncidentColumns } from "@/components/data-table/incidents/columns";
import { useMaintenanceColumns } from "@/components/data-table/maintenances/columns";
import {
  MetricCard,
  MetricCardGroup,
  MetricCardHeader,
  MetricCardTitle,
  MetricCardValue,
} from "@/components/metric/metric-card";
import { DataTable } from "@/components/ui/data-table/data-table";
import { useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

import { DataTableStatusReports } from "./data-table-status-reports";

// FIXME: the page is server side
// whenever I change the maintenances, the page is not updated
// we need to move the queryClient to the layout and prefetch the data there

export default function Page() {
  const trpc = useTRPC();
  const t = useTranslations("overview");
  const incidentsColumns = useIncidentColumns();
  const maintenancesColumns = useMaintenanceColumns();

  const { data: monitors } = useQuery(trpc.monitor.list.queryOptions());
  const { data: pages } = useQuery(trpc.page.list.queryOptions());
  const { data: incidents } = useQuery(
    trpc.incident.list.queryOptions({
      period: "7d",
    }),
  );
  const { data: statusReports } = useQuery(
    trpc.statusReport.list.queryOptions({
      period: "7d",
    }),
  );
  const { data: maintenances } = useQuery(
    trpc.maintenance.list.queryOptions({
      period: "7d",
    }),
  );

  if (!monitors || !pages || !incidents || !statusReports || !maintenances)
    return null;

  const lastIncident = incidents.length > 0 ? incidents[0] : null;
  const lastStatusReport = statusReports.length > 0 ? statusReports[0] : null;
  const lastMaintenance = maintenances.length > 0 ? maintenances[0] : null;

  const incidentDistance = lastIncident
    ? formatDistanceToNowStrict(lastIncident.startedAt, {
        addSuffix: true,
      })
    : t("none");

  const statusReportDistance = lastStatusReport?.createdAt
    ? formatDistanceToNowStrict(lastStatusReport.createdAt, {
        addSuffix: true,
      })
    : t("none");

  const maintenanceDistance = lastMaintenance?.createdAt
    ? formatDistanceToNowStrict(lastMaintenance.createdAt, {
        addSuffix: true,
      })
    : t("none");

  const metrics = [
    {
      title: t("monitors"),
      value: monitors.length,
      href: "/monitors",
      variant: "default" as const,
      icon: List,
    },
    {
      title: t("statusPages"),
      value: pages.length,
      href: "/status-pages",
      variant: "default" as const,
      icon: List,
    },
    {
      title:
        lastIncident?.resolvedAt === undefined && lastIncident
          ? t("activeIncident")
          : t("recentIncident"),
      value: incidentDistance,
      disabled: !lastIncident?.monitorId,
      href: `/monitors/${lastIncident?.monitorId}/incidents`,
      variant:
        lastIncident?.resolvedAt === undefined && lastIncident
          ? ("warning" as const)
          : ("default" as const),
      icon: Search,
    },
    {
      title: t("lastReport"),
      value: statusReportDistance,
      disabled: !lastStatusReport?.pageId,
      href: `/status-pages/${lastStatusReport?.pageId}/status-reports`,
      variant: "default" as const,
      icon: Search,
    },
    {
      title: t("lastMaintenance"),
      value: maintenanceDistance,
      disabled: !lastMaintenance?.pageId,
      href: `/status-pages/${lastMaintenance?.pageId}/maintenances`,
      variant: "default" as const,
      icon: Search,
    },
  ];

  return (
    <SectionGroup>
      <Note>
        <Bot />
        {t("slackAgentNote")}
        <NoteButton variant="default" asChild>
          <Link href="/agents">{t("learnMore")}</Link>
        </NoteButton>
      </Note>
      <Section>
        <SectionHeader>
          <SectionTitle>{t("title")}</SectionTitle>
          <SectionDescription>
            {t("description")}
          </SectionDescription>
        </SectionHeader>
        <MetricCardGroup>
          {metrics.map((metric) => (
            <Link
              href={metric.href}
              key={metric.title}
              className={cn(metric.disabled && "pointer-events-none")}
              aria-disabled={metric.disabled}
            >
              <MetricCard variant={metric.variant}>
                <MetricCardHeader className="flex items-center justify-between gap-2">
                  <MetricCardTitle className="truncate">
                    {metric.title}
                  </MetricCardTitle>
                  <metric.icon className="size-4" />
                </MetricCardHeader>
                <MetricCardValue>{metric.value}</MetricCardValue>
              </MetricCard>
            </Link>
          ))}
        </MetricCardGroup>
      </Section>
      <Section>
        <SectionHeader>
          <SectionTitle>{t("incidents")}</SectionTitle>
          <SectionDescription>
            {t("incidentsDescription")}
          </SectionDescription>
        </SectionHeader>
        {incidents.length > 0 ? (
          <DataTable columns={incidentsColumns} data={incidents} />
        ) : (
          <EmptyStateContainer>
            <EmptyStateTitle>{t("noIncidents")}</EmptyStateTitle>
          </EmptyStateContainer>
        )}
      </Section>
      <Section>
        <SectionHeader>
          <SectionTitle>{t("reports")}</SectionTitle>
          <SectionDescription>{t("reportsDescription")}</SectionDescription>
        </SectionHeader>
        {statusReports.length > 0 ? (
          <DataTableStatusReports statusReports={statusReports} />
        ) : (
          <EmptyStateContainer>
            <EmptyStateTitle>{t("noReports")}</EmptyStateTitle>
          </EmptyStateContainer>
        )}
      </Section>
      <Section>
        <SectionHeader>
          <SectionTitle>{t("maintenance")}</SectionTitle>
          <SectionDescription>
            {t("maintenanceDescription")}
          </SectionDescription>
        </SectionHeader>
        {maintenances.length > 0 ? (
          <DataTable columns={maintenancesColumns} data={maintenances} />
        ) : (
          <EmptyStateContainer>
            <EmptyStateTitle>{t("noMaintenances")}</EmptyStateTitle>
          </EmptyStateContainer>
        )}
      </Section>
    </SectionGroup>
  );
}
