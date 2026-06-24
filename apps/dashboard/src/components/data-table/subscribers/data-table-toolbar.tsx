"use client";

import type { RouterOutputs } from "@openstatus/api";
import { Button } from "@openstatus/ui/components/ui/button";
import type { Table } from "@tanstack/react-table";
import { CircleCheck, Globe, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { DataTableFacetedFilter } from "@/components/ui/data-table/data-table-faceted-filter";

type Subscriber = RouterOutputs["pageSubscriber"]["list"][number];

function filterAvailable<T extends { value: string }>(
  options: T[],
  facets: Map<string, number> | undefined,
) {
  if (!facets) return [];
  return options.filter((option) => facets.has(option.value));
}

export function SubscribersDataTableToolbar({
  table,
}: {
  table: Table<Subscriber>;
}) {
  const t = useTranslations("statusPages.subscribers.table");
  const isFiltered = table.getState().columnFilters.length > 0;
  const statusOptionsBase = [
    { label: t("active"), value: "active" },
    { label: t("pending"), value: "pending" },
    { label: t("unsubscribed"), value: "unsubscribed" },
  ];
  const sourceOptionsBase = [
    { label: t("selfSignup"), value: "self_signup" },
    { label: t("vendor"), value: "vendor" },
    { label: t("import"), value: "import" },
  ];

  const statusFacets = table.getColumn("status")?.getFacetedUniqueValues();
  const sourceFacets = table.getColumn("source")?.getFacetedUniqueValues();

  const statusOptions = filterAvailable(statusOptionsBase, statusFacets);
  const sourceOptions = filterAvailable(sourceOptionsBase, sourceFacets);

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {table.getColumn("status") && statusOptions.length > 0 && (
          <DataTableFacetedFilter
            column={table.getColumn("status")}
            title={t("status")}
            options={statusOptions}
            icon={CircleCheck}
          />
        )}
        {table.getColumn("source") && sourceOptions.length > 0 && (
          <DataTableFacetedFilter
            column={table.getColumn("source")}
            title={t("source")}
            options={sourceOptions}
            icon={Globe}
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
