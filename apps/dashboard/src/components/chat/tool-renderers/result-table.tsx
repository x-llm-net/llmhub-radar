"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openstatus/ui/components/ui/table";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

/**
 * Tabular result view used by `list_*` chat tool renderers — the read-side
 * counterpart to `ChangesTable`. Each tool ships a descriptor (e.g.
 * `listStatusPagesTable`) that maps the tool's output to columns + rows;
 * the registry consumes it via `<ResultTable {...descriptor(output)} />`.
 *
 * `cellClassName` on a column applies to every cell in that column — keep
 * per-row formatting (mono, badges) in the column definition rather than in
 * each row's cell.
 */
export type ResultColumn<K extends string = string> = {
  key: K;
  header: string;
  cellClassName?: string;
};

export type ResultRow<K extends string = string> = {
  id: string | number;
  cells: Record<K, ReactNode>;
};

export type ResultTableData<K extends string = string> = {
  columns: ResultColumn<K>[];
  rows: ResultRow<K>[];
  empty: string;
};

const RESULT_COPY_KEYS = {
  Action: "action",
  Active: "active",
  Actor: "actor",
  Duration: "duration",
  Entity: "entity",
  ID: "id",
  Latency: "latency",
  Monitor: "monitor",
  Monitors: "monitors",
  Name: "name",
  Page: "page",
  Periodicity: "periodicity",
  Provider: "provider",
  Region: "region",
  Regions: "regions",
  Slug: "slug",
  Start: "start",
  Status: "status",
  Timestamp: "timestamp",
  Timing: "timing",
  Title: "title",
  Snippet: "snippet",
  Type: "type",
  "No audit log entries.": "noAuditLogEntries",
  "No maintenance windows.": "noMaintenanceWindows",
  "No results.": "noResults",
  "No monitors.": "noMonitors",
  "No notification channels.": "noNotificationChannels",
  "No page components.": "noPageComponents",
  "No regions reporting yet.": "noRegionsReporting",
  "No response logs in this window.": "noResponseLogsInWindow",
  "No status pages.": "noStatusPages",
  "No status reports.": "noStatusReports",
} as const;

function useToolRendererCopy() {
  const t = useTranslations("chat.toolRenderers");
  return (value: string) => {
    const key = RESULT_COPY_KEYS[value as keyof typeof RESULT_COPY_KEYS];
    return key ? t(key) : value;
  };
}

export function ResultTable<K extends string>({
  columns,
  rows,
  empty,
}: ResultTableData<K>) {
  const copy = useToolRendererCopy();
  if (rows.length === 0) {
    return (
      <div className="bg-background text-muted-foreground rounded-md border p-3 text-sm">
        {copy(empty)}
      </div>
    );
  }
  return (
    <div className="bg-background overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            {columns.map((col) => (
              <TableHead
                key={col.key}
                className="text-muted-foreground font-mono"
              >
                {copy(col.header)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              {columns.map((col) => (
                <TableCell key={col.key} className={col.cellClassName}>
                  {row.cells[col.key]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
