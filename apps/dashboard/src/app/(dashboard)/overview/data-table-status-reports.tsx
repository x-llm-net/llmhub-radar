"use client";

import type { RouterOutputs } from "@openstatus/api";
import { useTranslations } from "next-intl";

import { DataTable as UpdatesDataTable } from "@/components/data-table/status-report-updates/data-table";
import { getColumns as getStatusReportsColumns } from "@/components/data-table/status-reports/columns";
import { DataTable } from "@/components/ui/data-table/data-table";

type StatusReport = RouterOutputs["statusReport"]["list"][number];

export function DataTableStatusReports({
  statusReports,
}: {
  statusReports: StatusReport[];
}) {
  const tableT = useTranslations("statusPages.reports.table");

  return (
    <DataTable
      columns={getStatusReportsColumns({
        title: tableT("title"),
        currentStatus: tableT("currentStatus"),
        impact: tableT("impact"),
        updates: tableT("updates"),
        affected: tableT("affected"),
        startedAt: tableT("startedAt"),
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
        />
      )}
    />
  );
}
