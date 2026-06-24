"use client";

import type { RouterOutputs } from "@openstatus/api";
import { Badge } from "@openstatus/ui/components/ui/badge";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import Link from "next/link";

import { DataTableColumnHeader } from "@/components/ui/data-table/data-table-column-header";
import { type NotifierProvider, config } from "@/data/notifications.client";

import { TableCellBadge } from "../table-cell-badge";
import { DataTableRowActions } from "./data-table-row-actions";

type Notifier = RouterOutputs["notification"]["list"][number];

export type NotificationColumnLabels = {
  name: string;
  provider: string;
  monitors: string;
};

const defaultLabels: NotificationColumnLabels = {
  name: "Name",
  provider: "Provider",
  monitors: "Monitors",
};

export function getColumns(
  labels: NotificationColumnLabels = defaultLabels,
): ColumnDef<Notifier>[] {
  return [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title={labels.name} />
    ),
    enableHiding: false,
  },
  {
    accessorKey: "provider",
    header: labels.provider,
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => {
      const provider = row.getValue("provider") as NotifierProvider;
      const Icon = config[provider].icon;
      return (
        <Badge variant="secondary" className="px-1.5 font-mono text-[10px]">
          <Icon className="size-2.5" />
          {config[provider].label}
        </Badge>
      );
    },
  },
  {
    accessorKey: "monitors",
    header: labels.monitors,
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => {
      const value = row.getValue("monitors");
      if (Array.isArray(value) && value.length > 0 && "name" in value[0]) {
        return (
          <div className="flex flex-wrap gap-1">
            {value.map((m) => (
              <Link href={`/monitors/${m.id}`} key={m.id}>
                <TableCellBadge value={m.name} />
              </Link>
            ))}
          </div>
        );
      }
      return <span className="text-muted-foreground">-</span>;
    },
    meta: {
      cellClassName: "tabular-nums font-mono",
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

export function useNotificationColumns() {
  const t = useTranslations("notifications.table");
  return getColumns({
    name: t("name"),
    provider: t("provider"),
    monitors: t("monitors"),
  });
}

export const columns = getColumns();
