"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@openstatus/ui/components/ui/tabs";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { CalendarClock, Megaphone, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";

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
import { useMaintenanceColumns } from "@/components/data-table/maintenances/columns";
import { getColumns } from "@/components/data-table/status-reports/columns";
import { FormSheetMaintenance } from "@/components/forms/maintenance/sheet";
import { FormSheetStatusReport } from "@/components/forms/status-report/sheet";
import { toCheckboxTreeItems } from "@/components/ui/checkbox-tree";
import { DataTable } from "@/components/ui/data-table/data-table";
import { useStatusReportLabels } from "@/hooks/use-status-report-labels";
import { useTRPC } from "@/lib/trpc/client";

export function Client() {
  const t = useTranslations("radar");
  const tableT = useTranslations("statusPages.reports.table");
  const { statusLabels, impactLabels } = useStatusReportLabels();
  const params = useParams<{ slug: string }>();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const maintenanceColumns = useMaintenanceColumns();

  const { data: pool } = useQuery(
    trpc.radar.getPool.queryOptions({ slug: params.slug }),
  );
  const pageId = pool?.pageId ?? null;

  const { data: page } = useQuery(
    trpc.page.get.queryOptions(pageId != null ? { id: pageId } : skipToken),
  );
  const { data: statusReports, refetch: refetchStatusReports } = useQuery(
    trpc.statusReport.list.queryOptions(
      pageId != null ? { pageId } : skipToken,
    ),
  );
  const { data: maintenances, refetch: refetchMaintenances } = useQuery(
    trpc.maintenance.list.queryOptions(
      pageId != null ? { pageId } : skipToken,
    ),
  );

  const sendStatusReportUpdateMutation = useMutation(
    trpc.emailRouter.sendStatusReport.mutationOptions(),
  );
  const createStatusReportMutation = useMutation(
    trpc.statusReport.create.mutationOptions({
      onSuccess: async (statusReportUpdate) => {
        if (statusReportUpdate?.notifySubscribers) {
          await sendStatusReportUpdateMutation.mutateAsync({
            id: statusReportUpdate.id,
          });
        }
        await refetchStatusReports();
        queryClient.invalidateQueries({ queryKey: trpc.page.list.queryKey() });
      },
    }),
  );

  const sendMaintenanceUpdateMutation = useMutation(
    trpc.emailRouter.sendMaintenance.mutationOptions(),
  );
  const createMaintenanceMutation = useMutation(
    trpc.maintenance.new.mutationOptions({
      onSuccess: async (maintenance) => {
        if (maintenance?.notifySubscribers) {
          await sendMaintenanceUpdateMutation.mutateAsync({
            id: maintenance.id,
          });
        }
        await refetchMaintenances();
      },
    }),
  );

  if (!pool || pageId == null) {
    return (
      <SectionGroup>
        <EmptyStateContainer className="min-h-72">
          <EmptyStateTitle>{t("announcementsUnavailable")}</EmptyStateTitle>
          <EmptyStateDescription>
            {t("announcementsUnavailableDescription")}
          </EmptyStateDescription>
        </EmptyStateContainer>
      </SectionGroup>
    );
  }

  if (!page || !statusReports || !maintenances) return null;

  const componentItems = toCheckboxTreeItems(
    page.pageComponents,
    page.pageComponentGroups,
  );
  const hasUnresolvedIssue = statusReports.some(
    (report) => report.status !== "resolved",
  );

  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>{t("announcements")}</SectionTitle>
          <SectionDescription>
            {t("announcementsDescription")}
          </SectionDescription>
        </SectionHeader>
        <EmptyStateContainer className="items-start gap-1.5 border-solid">
          <EmptyStateTitle>{t("announcementNotifyTitle")}</EmptyStateTitle>
          <EmptyStateDescription className="text-left">
            {t("announcementNotifyDescription")}
          </EmptyStateDescription>
        </EmptyStateContainer>
      </Section>

      <Tabs defaultValue="incidents" className="space-y-4">
        <TabsList>
          <TabsTrigger value="incidents">
            <Megaphone className="size-3.5" />
            {t("serviceEvents")}
          </TabsTrigger>
          <TabsTrigger value="maintenances">
            <CalendarClock className="size-3.5" />
            {t("plannedMaintenance")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="incidents">
          <Section>
            <SectionHeaderRow>
              <SectionHeader>
                <SectionTitle>{t("serviceEvents")}</SectionTitle>
                <SectionDescription>
                  {t("serviceEventsDescription")}
                </SectionDescription>
              </SectionHeader>
              <FormSheetStatusReport
                warning={
                  hasUnresolvedIssue ? (
                    <>{t("unresolvedAnnouncementWarning")}</>
                  ) : undefined
                }
                items={componentItems}
                onSubmit={async (values) => {
                  if (!("date" in values)) return;
                  const componentImpacts = values.pageComponents.map(
                    (pageComponentId) => ({
                      pageComponentId,
                      impact:
                        values.componentImpacts?.find(
                          (ci) => ci.pageComponentId === pageComponentId,
                        )?.impact ?? ("degraded_performance" as const),
                    }),
                  );

                  await createStatusReportMutation.mutateAsync({
                    title: values.title,
                    status: values.status,
                    pageId,
                    pageComponents: values.pageComponents,
                    componentImpacts,
                    date: values.date,
                    message: values.message,
                    notifySubscribers: values.notifySubscribers,
                  });
                }}
              >
                <Button data-section="action" size="sm">
                  <Plus />
                  {t("createServiceEvent")}
                </Button>
              </FormSheetStatusReport>
            </SectionHeaderRow>
            <DataTable
              columns={getColumns({
                title: tableT("title"),
                currentStatus: tableT("currentStatus"),
                impact: tableT("impact"),
                updates: tableT("updates"),
                affected: tableT("affected"),
                startedAt: tableT("startedAt"),
                statuses: statusLabels,
                impacts: impactLabels,
                expand: (title) => tableT("expand", { title }),
                collapse: (title) => tableT("collapse", { title }),
              })}
              data={statusReports}
              defaultColumnVisibility={{
                actions: false,
                expander: false,
              }}
            />
          </Section>
        </TabsContent>

        <TabsContent value="maintenances">
          <Section>
            <SectionHeaderRow>
              <SectionHeader>
                <SectionTitle>{t("plannedMaintenance")}</SectionTitle>
                <SectionDescription>
                  {t("plannedMaintenanceDescription")}
                </SectionDescription>
              </SectionHeader>
              <FormSheetMaintenance
                items={componentItems}
                onSubmit={async (values) => {
                  await createMaintenanceMutation.mutateAsync({
                    pageId,
                    title: values.title,
                    message: values.message,
                    startDate: values.startDate,
                    endDate: values.endDate,
                    pageComponents: values.pageComponents,
                    notifySubscribers: values.notifySubscribers,
                  });
                }}
              >
                <Button data-section="action" size="sm">
                  <Plus />
                  {t("createMaintenance")}
                </Button>
              </FormSheetMaintenance>
            </SectionHeaderRow>
            <DataTable columns={maintenanceColumns} data={maintenances} />
          </Section>
        </TabsContent>
      </Tabs>
    </SectionGroup>
  );
}
