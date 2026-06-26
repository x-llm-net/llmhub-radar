"use client";

import type { RouterOutputs } from "@openstatus/api";
import type { StatusReportStatus } from "@openstatus/db/src/schema";
import {
  type PageComponentImpact,
  worstImpact,
} from "@openstatus/db/src/schema/page_components/constants";
import { Button } from "@openstatus/ui/components/ui/button";
import { cn } from "@openstatus/ui/lib/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, ChevronUp } from "lucide-react";

import { TableCellDate } from "@/components/data-table/table-cell-date";
import { TableCellLink } from "@/components/data-table/table-cell-link";
import { TableCellNumber } from "@/components/data-table/table-cell-number";
import { DataTableColumnHeader } from "@/components/ui/data-table/data-table-column-header";
import {
  colors,
  getStatusReportImpactLabel,
  getStatusReportStatusLabel,
  impactConfig,
  type StatusReportImpactLabels,
  type StatusReportStatusLabels,
  untriagedImpact,
} from "@/data/status-report-updates.client";

import { DataTableRowActions } from "./data-table-row-actions";

type StatusReport = RouterOutputs["statusReport"]["list"][number];

export type StatusReportColumnLabels = {
  title: string;
  currentStatus: string;
  impact: string;
  updates: string;
  affected: string;
  startedAt: string;
  statuses?: StatusReportStatusLabels;
  impacts?: StatusReportImpactLabels;
  expand: (title: string) => string;
  collapse: (title: string) => string;
};

const defaultLabels: StatusReportColumnLabels = {
  title: "Title",
  currentStatus: "Current Status",
  impact: "Impact",
  updates: "Updates",
  affected: "Affected",
  startedAt: "Started At",
  expand: (title) => `Expand details for ${title}`,
  collapse: (title) => `Collapse details for ${title}`,
};

// derived top-level impact = worst impact set by any update, not the
// current one (a resolved report would always read "Operational");
// legacy reports (no impact rows) read "Untriaged"
function worstReportImpact(report: StatusReport) {
  const impacts = report.updates.flatMap((u) =>
    u.componentImpacts.map((ci) => ci.impact),
  );
  if (impacts.length === 0) return null;
  return worstImpact(impacts);
}

export function getColumns(
  labels: StatusReportColumnLabels = defaultLabels,
): ColumnDef<StatusReport>[] {
  return [
  {
    id: "expander",
    header: () => null,
    cell: ({ row }) => {
      return row.getCanExpand() ? (
        <Button
          {...{
            className: "size-7 shadow-none text-muted-foreground",
            onClick: (e) => {
              e.stopPropagation();
              row.toggleExpanded();
            },
            "aria-expanded": row.getIsExpanded(),
            "aria-label": row.getIsExpanded()
              ? labels.collapse(row.original.title)
              : labels.expand(row.original.title),
            size: "icon",
            variant: "ghost",
          }}
        >
          {row.getIsExpanded() ? (
            <ChevronUp className="opacity-60" size={16} aria-hidden="true" />
          ) : (
            <ChevronDown className="opacity-60" size={16} aria-hidden="true" />
          )}
        </Button>
      ) : undefined;
    },
    meta: {
      headerClassName: "w-7",
    },
  },
  {
    accessorKey: "title",
    header: labels.title,
    cell: ({ row }) => {
      const { id, pageId } = row.original;

      return (
        <TableCellLink
          href={`/status-pages/${pageId}/status-reports/${id}`}
          onClick={(e) => {
            // avoid expanding the row
            e.stopPropagation();
          }}
          value={row.getValue("title")}
        />
      );
    },
    enableSorting: false,
    enableHiding: false,
    meta: {
      cellClassName: "max-w-[200px] truncate",
    },
  },
  {
    accessorKey: "status",
    header: labels.currentStatus,
    cell: ({ row }) => {
      const value = row.getValue("status") as StatusReportStatus;
      return (
        <div
          className={cn(
            "font-medium",
            colors[value as keyof typeof colors],
          )}
        >
          {getStatusReportStatusLabel(value, labels.statuses)}
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    id: "impact",
    accessorFn: (row) => worstReportImpact(row),
    header: labels.impact,
    cell: ({ row }) => {
      const impact = row.getValue<PageComponentImpact | null>("impact");
      const config = impact ? impactConfig[impact] : untriagedImpact;
      return (
        <div className={cn("font-medium", config.color)}>
          {getStatusReportImpactLabel(impact ?? "untriaged", labels.impacts)}
        </div>
      );
    },
    enableSorting: false,
  },
  {
    id: "updates",
    accessorFn: (row) => row.updates.length,
    header: labels.updates,
    cell: ({ row }) => {
      const value = row.getValue("updates");
      return <TableCellNumber value={value} />;
    },
  },
  {
    id: "pageComponents",
    accessorFn: (row) => row?.pageComponents,
    header: labels.affected,
    cell: ({ row }) => {
      const value = row.getValue("pageComponents");
      if (Array.isArray(value) && value.length > 0 && "name" in value[0]) {
        const names = value.map((m) => m.name).join(", ");
        return (
          <div
            className="max-w-[380px] truncate whitespace-nowrap text-sm leading-5"
            title={names}
          >
            {names}
          </div>
        );
      }
      return <div className="text-muted-foreground">-</div>;
    },
    meta: {
      headerClassName: "min-w-[260px] whitespace-nowrap",
      cellClassName: "min-w-[260px] max-w-[380px]",
    },
  },
  {
    id: "startedAt",
    accessorFn: (row) =>
      row.updates.sort((a, b) => a.date.getTime() - b.date.getTime())[0]
        ?.date ?? row.createdAt,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title={labels.startedAt} />
    ),
    cell: ({ row }) => <TableCellDate value={row.getValue("startedAt")} />,
    enableHiding: false,
    meta: {
      cellClassName: "w-[170px]",
    },
  },
  {
    id: "actions",
    cell: ({ row }) => <DataTableRowActions row={row} />,
    meta: {
      cellClassName: "w-8",
    },
  },
  ];
}

export const columns = getColumns();
