"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@openstatus/ui/components/ui/table";
import { useTranslations } from "next-intl";
import { Fragment, type ReactNode } from "react";

export type DetailsRow = {
  label: string;
  value: ReactNode;
};

export type DetailsSection = {
  title?: string;
  rows: DetailsRow[];
};

export type DetailsTableData = {
  sections: DetailsSection[];
  empty?: string;
};

const DETAILS_COPY_KEYS = {
  Active: "active",
  Assertions: "assertions",
  Behavior: "behavior",
  Checks: "checks",
  "Degraded after": "degradedAfter",
  Degraded: "degraded",
  Error: "error",
  Failed: "failed",
  "Follow redirects": "followRedirects",
  Headers: "headers",
  ID: "id",
  IDs: "ids",
  Latency: "latency",
  "Last check": "lastCheck",
  "Log ID": "logId",
  Message: "message",
  Method: "method",
  Monitor: "monitor",
  Name: "name",
  Notifications: "notifications",
  Periodicity: "periodicity",
  "Private locations": "privateLocations",
  Public: "public",
  Region: "region",
  Regions: "regions",
  Retry: "retry",
  Status: "status",
  "Status code": "statusCode",
  Successful: "successful",
  Tags: "tags",
  Timestamp: "timestamp",
  Timeout: "timeout",
  Trigger: "trigger",
  Type: "type",
  URL: "url",
  Visibility: "visibility",
  Window: "window",
  "No details to show.": "noDetailsToShow",
} as const;

function useToolRendererCopy() {
  const t = useTranslations("chat.toolRenderers");
  return (value: string) => {
    const key = DETAILS_COPY_KEYS[value as keyof typeof DETAILS_COPY_KEYS];
    return key ? t(key) : value;
  };
}

export function DetailsTable({ sections, empty }: DetailsTableData) {
  const copy = useToolRendererCopy();
  const total = sections.reduce((acc, s) => acc + s.rows.length, 0);
  if (total === 0) {
    return (
      <div className="bg-background text-muted-foreground rounded-md border p-3 text-sm">
        {copy(empty ?? "No details to show.")}
      </div>
    );
  }
  return (
    <div className="bg-background overflow-hidden rounded-md border">
      <Table>
        <TableBody>
          {sections.map((section, sIdx) => (
            <Fragment key={section.title ?? sIdx}>
              {section.title ? (
                <TableRow className="hover:bg-transparent">
                  <TableHead colSpan={2}>{copy(section.title)}</TableHead>
                </TableRow>
              ) : null}
              {section.rows.map((row) => (
                <TableRow
                  key={`${sIdx}-${row.label}`}
                  className="hover:bg-transparent"
                >
                  <TableHead className="bg-muted/40 text-muted-foreground w-1/3 border-r font-mono">
                    {copy(row.label)}
                  </TableHead>
                  <TableCell className="font-mono break-words whitespace-normal">
                    {row.value}
                  </TableCell>
                </TableRow>
              ))}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
