"use client";

import type { RouterOutputs } from "@openstatus/api";
import { Button } from "@openstatus/ui/components/ui/button";
import { Input } from "@openstatus/ui/components/ui/input";
import type { Table } from "@tanstack/react-table";
import { Tag, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { DataTableFacetedFilter } from "@/components/ui/data-table/data-table-faceted-filter";

type Monitor = RouterOutputs["monitor"]["list"][number];
type MonitorTag = RouterOutputs["monitorTag"]["list"][number];

export interface MonitorDataTableToolbarProps {
  table: Table<Monitor>;
  tags: MonitorTag[];
}

export function MonitorDataTableToolbar({
  table,
  tags,
}: MonitorDataTableToolbarProps) {
  const t = useTranslations("monitors.table");
  const isFiltered = table.getState().columnFilters.length > 0;

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-1 flex-wrap items-center space-x-2">
        <Input
          placeholder={t("filterPlaceholder")}
          value={(table.getState().globalFilter as string) ?? ""}
          onChange={(event) => table.setGlobalFilter(event.target.value)}
          className="h-8 w-[150px] lg:w-[250px]"
        />
        {table.getColumn("tags") && (
          <DataTableFacetedFilter
            column={table.getColumn("tags")}
            title={t("tags")}
            options={tags.map((tag) => ({
              label: tag.name,
              value: tag.id,
            }))}
            icon={Tag}
          />
        )}
        {isFiltered && (
          <Button
            variant="ghost"
            onClick={() => table.resetColumnFilters()}
            className="h-8 px-2 lg:px-3"
          >
            {t("resetFilters")}
            <X />
          </Button>
        )}
      </div>
    </div>
  );
}
