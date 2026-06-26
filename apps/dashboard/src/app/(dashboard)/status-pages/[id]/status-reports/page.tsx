"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";

import { Link } from "@/components/common/link";
import { Note } from "@/components/common/note";
import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionHeaderRow,
  SectionTitle,
} from "@/components/content/section";
import { DataTable as UpdatesDataTable } from "@/components/data-table/status-report-updates/data-table";
import { getColumns } from "@/components/data-table/status-reports/columns";
import { FormSheetStatusReport } from "@/components/forms/status-report/sheet";
import { toCheckboxTreeItems } from "@/components/ui/checkbox-tree";
import { DataTable } from "@/components/ui/data-table/data-table";
import { useStatusReportLabels } from "@/hooks/use-status-report-labels";
import { useTRPC } from "@/lib/trpc/client";

export default function Page() {
  const t = useTranslations("statusPages.reports");
  const tableT = useTranslations("statusPages.reports.table");
  const { statusLabels, impactLabels } = useStatusReportLabels();
  const { id } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: page } = useQuery(
    trpc.page.get.queryOptions({ id: Number.parseInt(id) }),
  );
  const { data: statusReports, refetch } = useQuery(
    trpc.statusReport.list.queryOptions({ pageId: Number.parseInt(id) }),
  );
  const sendStatusReportUpdateMutation = useMutation(
    trpc.emailRouter.sendStatusReport.mutationOptions(),
  );
  const createStatusReportMutation = useMutation(
    trpc.statusReport.create.mutationOptions({
      onSuccess: async (statusReport) => {
        // TODO: move to server
        if (statusReport.notifySubscribers) {
          await sendStatusReportUpdateMutation.mutateAsync({
            id: statusReport.id,
          });
        }
        //
        refetch();
        queryClient.invalidateQueries({
          queryKey: trpc.page.list.queryKey(),
        });
      },
    }),
  );

  if (!statusReports || !page) return null;

  const hasUnresolvedIssue = statusReports.some(
    (report) => report.status !== "resolved",
  );

  return (
    <SectionGroup>
      <Note>
        <Gauge />
        {t("impactNote")}
      </Note>
      <Section>
        <SectionHeaderRow>
          <SectionHeader>
            <SectionTitle>{page.title}</SectionTitle>
            <SectionDescription>
              {t("descriptionPrefix")}{" "}
              <Link href={`/status-pages/${id}/maintenances`}>
                {t("maintenances")}
              </Link>
              ?
            </SectionDescription>
          </SectionHeader>
          <div>
            <FormSheetStatusReport
              warning={
                hasUnresolvedIssue ? (
                  <>{t("unresolvedWarning")}</>
                ) : undefined
              }
              items={toCheckboxTreeItems(
                page.pageComponents,
                page.pageComponentGroups,
              )}
              onSubmit={async (values) => {
                // NOTE: for type safety, we need to check if the values have a date property
                // because of the union type
                if ("date" in values) {
                  // every selected component gets an impact row — fresh
                  // reports are never legacy; fallback must match the
                  // picker's defaultImpact
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
                    pageId: Number.parseInt(id),
                    pageComponents: values.pageComponents,
                    componentImpacts,
                    date: values.date,
                    message: values.message,
                    notifySubscribers: values.notifySubscribers,
                  });
                }
              }}
            >
              <Button data-section="action" size="sm">
                <Plus />
                {t("create")}
              </Button>
            </FormSheetStatusReport>
          </div>
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
          onRowClick={(row) =>
            row.getCanExpand() ? row.toggleExpanded() : undefined
          }
          rowComponent={({ row }) => (
            <UpdatesDataTable
              updates={row.original.updates}
              reportId={row.original.id}
              components={row.original.pageComponents.map((c) => ({
                id: c.id,
                name: c.name,
              }))}
            />
          )}
        />
      </Section>
    </SectionGroup>
  );
}
