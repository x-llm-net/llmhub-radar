"use client";

import type { RouterOutputs } from "@openstatus/api";
import type { ColumnDef } from "@tanstack/react-table";
import { formatDistanceStrict } from "date-fns";
import { useTranslations } from "next-intl";

import { TableCellDate } from "@/components/data-table/table-cell-date";
import { TableCellLink } from "@/components/data-table/table-cell-link";
import { TableCellNumber } from "@/components/data-table/table-cell-number";
import { DataTableColumnHeader } from "@/components/ui/data-table/data-table-column-header";

import { DataTableRowActions } from "./data-table-row-actions";

type Incident = RouterOutputs["incident"]["list"][number];

export function useIncidentColumns(): ColumnDef<Incident>[] {
  const t = useTranslations("common");

  return [
    {
      id: "monitor",
      accessorFn: (row) => row.monitor.name,
      header: t("monitor"),
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        return (
          <TableCellLink
            value={row.getValue("monitor")}
            href={`/monitors/${row.original.monitor.id}/overview`}
          />
        );
      },
      meta: {
        cellClassName: "max-w-[150px] min-w-max",
      },
    },
    {
      accessorKey: "startedAt",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("startedAt")} />
      ),
      cell: ({ row }) => <TableCellDate value={row.getValue("startedAt")} />,
      enableHiding: false,
    },
    {
      accessorKey: "acknowledgedAt",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("acknowledged")} />
      ),
      cell: ({ row }) => (
        <TableCellDate value={row.getValue("acknowledgedAt")} />
      ),
      enableHiding: false,
    },
    {
      accessorKey: "resolvedAt",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("resolvedAt")} />
      ),
      cell: ({ row }) => <TableCellDate value={row.getValue("resolvedAt")} />,
      enableHiding: false,
    },
    {
      id: "duration",
      accessorFn: (row) =>
        row.resolvedAt
          ? formatDistanceStrict(row.startedAt, row.resolvedAt)
          : "ongoing",
      header: t("duration"),
      cell: ({ row }) => {
        const value = row.getValue("duration");
        if (typeof value === "string") {
          const [amount, unit] = value.split(" ");
          return <TableCellNumber value={amount} unit={unit} />;
        }
        return <TableCellNumber value={value} />;
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
