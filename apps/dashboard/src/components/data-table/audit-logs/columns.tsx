"use client";

import type { RouterOutputs } from "@openstatus/api";
import type { PrivateLocation } from "@openstatus/db/src/schema";
import type { ColumnDef } from "@tanstack/react-table";

import { HoverCardTimestamp } from "@/components/common/hover-card-timestamp";
import { Pill } from "@/components/common/pill";
import { TableCellDate } from "@/components/data-table/table-cell-date";
import { config, getMetadata } from "@/data/audit-logs.client";
import { cn } from "@/lib/utils";

type AuditLog = RouterOutputs["tinybird"]["auditLog"]["data"][number];

type AuditLogColumnLabels = {
  action: string;
  information: string;
  timestamp: string;
};

export function getColumns(
  privateLocations?: PrivateLocation[],
  labels: AuditLogColumnLabels = {
    action: "Action",
    information: "Information",
    timestamp: "Timestamp",
  },
): ColumnDef<AuditLog>[] {
  const metadata = getMetadata(privateLocations);
  return [
    {
      id: "icon",
      accessorFn: (row) => row.action,
      header: () => null,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        const value = row.getValue("action");
        const { icon: Icon, color } = config[value as keyof typeof config];
        if (!Icon) return null;
        return <Icon className={cn("size-4", color)} />;
      },
      meta: {
        headerClassName: "w-7",
      },
    },
    {
      accessorKey: "action",
      header: labels.action,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        const value = row.getValue("action");
        const { title } = config[value as keyof typeof config];
        if (!title) return null;
        return <div>{title}</div>;
      },
    },
    {
      accessorKey: "metadata",
      header: labels.information,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        const value = row.getValue("metadata");
        if (!value) return null;
        return (
          <div className="flex flex-wrap gap-2">
            {Object.entries(value)
              .filter(([key, value]) =>
                metadata[key as keyof typeof metadata]?.visible(value),
              )
              .map(([key, value]) => {
                return (
                  <Pill
                    key={key}
                    label={metadata[key as keyof typeof metadata].key}
                    value={metadata[key as keyof typeof metadata]?.format(
                      value,
                    )}
                  />
                );
              })}
          </div>
        );
      },
    },
    {
      accessorKey: "timestamp",
      header: labels.timestamp,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        const value = row.getValue("timestamp");
        if (value instanceof Date) {
          return (
            <HoverCardTimestamp date={value}>
              <TableCellDate value={value} className="font-mono" />
            </HoverCardTimestamp>
          );
        }
        const date = new Date(Number(value));
        if (Number.isNaN(date.getTime())) {
          return <div className="font-mono">{String(value)}</div>;
        }

        return (
          <HoverCardTimestamp date={date}>
            <TableCellDate value={date} className="font-mono" />
          </HoverCardTimestamp>
        );
      },
    },
  ];
}
