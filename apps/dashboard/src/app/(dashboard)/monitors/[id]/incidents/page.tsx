"use client";

import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";

import { Link } from "@/components/common/link";
import { Note } from "@/components/common/note";
import {
  EmptyStateContainer,
  EmptyStateDescription,
  EmptyStateTitle,
} from "@/components/content/empty-state";
import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { useIncidentColumns } from "@/components/data-table/incidents/columns";
import { DataTable } from "@/components/ui/data-table/data-table";
import { DataTablePaginationSimple } from "@/components/ui/data-table/data-table-pagination";
import { useTRPC } from "@/lib/trpc/client";

export default function Page() {
  const t = useTranslations("monitors.incidents");
  const columns = useIncidentColumns();
  const { id } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const { data: incidents } = useQuery(
    trpc.incident.list.queryOptions({
      monitorId: Number.parseInt(id),
    }),
  );
  const { data: monitor } = useQuery(
    trpc.monitor.get.queryOptions({ id: Number.parseInt(id) }),
  );

  if (!incidents || !monitor) return null;

  return (
    <SectionGroup>
      <Note color="info">
        <Info />
        <p>
          {t("notePrefix")}{" "}
          <Link href="/status-pages">{t("statusPage")}</Link>
          {t("noteSuffix")}
        </p>
      </Note>
      <Section>
        <SectionHeader>
          <SectionTitle>{monitor.name}</SectionTitle>
          <SectionDescription>
            {monitor.jobType === "http" ? (
              <a href={monitor.url} target="_blank" rel="noopener noreferrer">
                {monitor.url}
              </a>
            ) : (
              monitor.url
            )}
          </SectionDescription>
        </SectionHeader>
        {incidents.length === 0 ? (
          <EmptyStateContainer>
            <EmptyStateTitle>{t("emptyTitle")}</EmptyStateTitle>
            <EmptyStateDescription>{t("emptyDescription")}</EmptyStateDescription>
          </EmptyStateContainer>
        ) : (
          <DataTable
            columns={columns}
            data={incidents}
            paginationComponent={DataTablePaginationSimple}
          />
        )}
      </Section>
    </SectionGroup>
  );
}
