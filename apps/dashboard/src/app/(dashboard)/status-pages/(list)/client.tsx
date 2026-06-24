"use client";

import { useQuery } from "@tanstack/react-query";
import { Palette } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Note, NoteButton } from "@/components/common/note";
import {
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { getColumns } from "@/components/data-table/status-pages/columns";
import { DataTable } from "@/components/ui/data-table/data-table";
import { DataTablePaginationSimple } from "@/components/ui/data-table/data-table-pagination";
import { DataTableSkeleton } from "@/components/ui/data-table/data-table-skeleton";
import { useTRPC } from "@/lib/trpc/client";

export function Client() {
  const t = useTranslations("statusPages");
  const trpc = useTRPC();
  const { data: statusPages } = useQuery(trpc.page.list.queryOptions());

  if (!statusPages) return <DataTableSkeleton rows={3} />;

  return (
    <SectionGroup>
      <Note>
        <Palette />
        {t("list.themeNote")}
        <NoteButton variant="default" asChild>
          <Link href="https://themes.openstatus.dev" target="_blank">
            {t("list.learnMore")}
          </Link>
        </NoteButton>
      </Note>
      <SectionHeader>
        <SectionTitle>{t("list.title")}</SectionTitle>
        <SectionDescription>
          {t("list.description")}
        </SectionDescription>
        <DataTable
          columns={getColumns({
            title: t("table.title"),
            favicon: t("table.favicon"),
            faviconAlt: (title) => t("table.faviconAlt", { title }),
            slug: t("table.slug"),
            domain: t("table.domain"),
          })}
          data={statusPages}
          paginationComponent={DataTablePaginationSimple}
        />
      </SectionHeader>
    </SectionGroup>
  );
}
