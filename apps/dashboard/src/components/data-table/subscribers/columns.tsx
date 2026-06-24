"use client";

import type { RouterOutputs } from "@openstatus/api";
import { detectWebhookFlavor } from "@openstatus/subscriptions/client";
import { Badge } from "@openstatus/ui/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openstatus/ui/components/ui/tooltip";
import type { ColumnDef } from "@tanstack/react-table";

import { formatDate } from "@/lib/formatter";

import { DataTableRowActions } from "./data-table-row-actions";

type Subscriber = RouterOutputs["pageSubscriber"]["list"][number];
type SubscriberColumnLabels = {
  destination: string;
  source: string;
  vendor: string;
  import: string;
  selfSignup: string;
  components: string;
  entirePage: string;
  componentsCount: (count: number) => string;
  status: string;
  unsubscribed: string;
  pending: string;
  active: string;
  createdAt: string;
};

const FLAVOR_LABELS = {
  slack: "Slack",
  discord: "Discord",
  generic: "Webhook",
} as const;

function detectFlavorBadge(url: string | null) {
  if (!url) return null;
  return FLAVOR_LABELS[detectWebhookFlavor(url)];
}

export function getColumns(
  labels: SubscriberColumnLabels,
): ColumnDef<Subscriber>[] {
  return [
  {
    id: "destination",
    header: labels.destination,
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => {
      const sub = row.original;
      const raw = sub.channelType === "email" ? sub.email : sub.webhookUrl;
      const display = sub.name ?? raw ?? "";
      const flavor =
        sub.channelType === "webhook"
          ? detectFlavorBadge(sub.webhookUrl)
          : null;

      return (
        <div className="flex items-center gap-2">
          <span className="max-w-[280px] truncate">{display}</span>
          {flavor ? (
            <Badge variant="outline" className="text-xs">
              {flavor}
            </Badge>
          ) : null}
        </div>
      );
    },
  },
  {
    id: "source",
    accessorFn: (row) => row.source,
    header: labels.source,
    enableSorting: false,
    enableHiding: false,
    filterFn: (row, id, filterValue: string[]) => {
      if (!filterValue?.length) return true;
      return filterValue.includes(row.getValue(id) as string);
    },
    cell: ({ row }) => {
      const source = row.original.source;
      const label =
        source === "vendor"
          ? labels.vendor
          : source === "import"
            ? labels.import
            : labels.selfSignup;
      return (
        <Badge variant="outline" className="text-xs">
          {label}
        </Badge>
      );
    },
  },
  {
    id: "components",
    header: labels.components,
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => {
      const { components, isEntirePage } = row.original;
      if (isEntirePage) {
        return (
          <span className="text-muted-foreground text-xs">
            {labels.entirePage}
          </span>
        );
      }
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-xs">
              {labels.componentsCount(components.length)}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {components.map((c) => c.name).join(", ")}
          </TooltipContent>
        </Tooltip>
      );
    },
  },
  {
    id: "status",
    accessorFn: (row) => {
      if (row.unsubscribedAt) return "unsubscribed";
      if (!row.acceptedAt) return "pending";
      return "active";
    },
    header: labels.status,
    enableSorting: false,
    enableHiding: false,
    filterFn: (row, id, filterValue: string[]) => {
      if (!filterValue?.length) return true;
      return filterValue.includes(row.getValue(id) as string);
    },
    cell: ({ row }) => {
      const status = row.getValue("status") as string;
      if (status === "unsubscribed") {
        return <Badge variant="destructive">{labels.unsubscribed}</Badge>;
      }
      if (status === "pending") {
        return <Badge variant="outline">{labels.pending}</Badge>;
      }
      return <Badge variant="secondary">{labels.active}</Badge>;
    },
  },
  {
    accessorKey: "createdAt",
    header: labels.createdAt,
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => {
      const value = row.getValue("createdAt");
      if (value instanceof Date) return formatDate(value);
      if (!value) return "-";
      return value;
    },
    meta: {
      cellClassName: "font-mono",
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
