"use client";

import type { RouterOutputs } from "@openstatus/api";
import { Button } from "@openstatus/ui/components/ui/button";
import type { Table } from "@tanstack/react-table";
import { Database, User, X, Zap } from "lucide-react";
import { useTranslations } from "next-intl";

import { DataTableFacetedFilter } from "@/components/ui/data-table/data-table-faceted-filter";

type AuditLog = RouterOutputs["auditLog"]["list"]["items"][number];

function toOptions(values: Iterable<string>, labels?: Record<string, string>) {
  return Array.from(new Set(values))
    .filter(Boolean)
    .sort()
    .map((value) => ({ label: labels?.[value] ?? value, value }));
}

export function AuditLogsDataTableToolbar({
  table,
}: {
  table: Table<AuditLog>;
}) {
  const t = useTranslations("settings.auditLogs");
  const isFiltered = table.getState().columnFilters.length > 0;
  const actorTypeLabels: Record<string, string> = {
    user: t("actorUser"),
    apiKey: t("actorApiKey"),
    slack: "Slack",
    system: t("actorSystem"),
    subscriber: t("actorSubscriber"),
    mcp: "MCP",
  };

  const actionFacets = table.getColumn("action")?.getFacetedUniqueValues();
  const actorTypeFacets = table
    .getColumn("actorType")
    ?.getFacetedUniqueValues();
  const entityTypeFacets = table
    .getColumn("entityType")
    ?.getFacetedUniqueValues();

  const actionOptions = toOptions(actionFacets?.keys() ?? []);
  const actorTypeOptions = toOptions(
    actorTypeFacets?.keys() ?? [],
    actorTypeLabels,
  );
  const entityTypeOptions = toOptions(entityTypeFacets?.keys() ?? []);

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {table.getColumn("actorType") && actorTypeOptions.length > 0 && (
          <DataTableFacetedFilter
            column={table.getColumn("actorType")}
            title={t("actorType")}
            options={actorTypeOptions}
            icon={User}
          />
        )}
        {table.getColumn("action") && actionOptions.length > 0 && (
          <DataTableFacetedFilter
            column={table.getColumn("action")}
            title={t("action")}
            options={actionOptions}
            icon={Zap}
          />
        )}
        {table.getColumn("entityType") && entityTypeOptions.length > 0 && (
          <DataTableFacetedFilter
            column={table.getColumn("entityType")}
            title={t("entityType")}
            options={entityTypeOptions}
            icon={Database}
          />
        )}
        {isFiltered && (
          <Button
            variant="ghost"
            onClick={() => table.resetColumnFilters()}
            className="h-8 px-2 lg:px-3"
          >
            {t("reset")}
            <X />
          </Button>
        )}
      </div>
    </div>
  );
}
