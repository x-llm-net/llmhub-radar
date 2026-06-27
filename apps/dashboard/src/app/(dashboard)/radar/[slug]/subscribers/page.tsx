"use client";

import type { RouterOutputs } from "@openstatus/api";
import { Button } from "@openstatus/ui/components/ui/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useState } from "react";

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
  SectionHeaderRow,
  SectionTitle,
} from "@/components/content/section";
import { getColumns } from "@/components/data-table/subscribers/columns";
import { SubscribersDataTableToolbar } from "@/components/data-table/subscribers/data-table-toolbar";
import { FormSheetSubscriber } from "@/components/forms/subscriber/sheet";
import { toCheckboxTreeItems } from "@/components/ui/checkbox-tree";
import { DataTable } from "@/components/ui/data-table/data-table";
import { DataTablePaginationSimple } from "@/components/ui/data-table/data-table-pagination";
import { useTRPC } from "@/lib/trpc/client";

type Subscriber = RouterOutputs["pageSubscriber"]["list"][number];

export default function Page() {
  const params = useParams<{ slug: string }>();
  const t = useTranslations("statusPages.subscribers");
  const radarT = useTranslations("radar");
  const commonT = useTranslations("common");
  const locale = useLocale();
  const [openAdd, setOpenAdd] = useState(false);
  const trpc = useTRPC();

  const { data: pool } = useQuery(
    trpc.radar.getPool.queryOptions({ slug: params.slug }),
  );
  const pageId = pool?.pageId ?? 0;
  const { data: page } = useQuery({
    ...trpc.page.get.queryOptions({ id: pageId }),
    enabled: pageId > 0,
  });
  const { data: subscribers, refetch } = useQuery({
    ...trpc.pageSubscriber.list.queryOptions({ pageId }),
    enabled: pageId > 0,
  });
  const { data: workspace } = useQuery(trpc.workspace.get.queryOptions());
  const { data: components } = useQuery({
    ...trpc.pageComponent.list.queryOptions({ pageId }),
    enabled: pageId > 0,
  });

  const createAction = useMutation(
    trpc.pageSubscriber.createSubscription.mutationOptions({
      onSuccess: () => refetch(),
    }),
  );

  if (!pool || !workspace) {
    return (
      <SectionGroup>
        <EmptyStateContainer className="min-h-32">
          <EmptyStateTitle>{commonT("loading")}</EmptyStateTitle>
        </EmptyStateContainer>
      </SectionGroup>
    );
  }

  if (!pageId) {
    return (
      <SectionGroup>
        <Section>
          <EmptyStateContainer className="min-h-40">
            <EmptyStateTitle>{radarT("announcementsUnavailable")}</EmptyStateTitle>
            <EmptyStateDescription>
              {radarT("announcementsUnavailableDescription")}
            </EmptyStateDescription>
          </EmptyStateContainer>
        </Section>
      </SectionGroup>
    );
  }

  const items = toCheckboxTreeItems(
    components ?? [],
    page?.pageComponentGroups ?? [],
  );
  const columns = getColumns({
    destination: t("table.destination"),
    source: t("table.source"),
    vendor: t("table.vendor"),
    import: t("table.import"),
    selfSignup: t("table.selfSignup"),
    components: t("table.components"),
    entirePage: t("table.entirePage"),
    componentsCount: (count) => t("table.componentsCount", { count }),
    status: t("table.status"),
    unsubscribed: t("table.unsubscribed"),
    pending: t("table.pending"),
    active: t("table.active"),
    createdAt: t("table.createdAt"),
  });
  const subscriberData: Subscriber[] = subscribers ?? [];

  return (
    <SectionGroup>
      <Section>
        <SectionHeaderRow>
          <SectionHeader>
            <SectionTitle>{page?.title ?? pool.name}</SectionTitle>
            <SectionDescription>{t("description")}</SectionDescription>
          </SectionHeader>
          <FormSheetSubscriber
            open={openAdd}
            onOpenChange={setOpenAdd}
            items={items}
            onSubmit={async (values) => {
              if (values.channelType === "email") {
                await createAction.mutateAsync({
                  pageId,
                  channelType: "email",
                  email: values.email,
                  name: values.name || null,
                  locale,
                  componentIds: values.componentIds,
                });
              } else {
                await createAction.mutateAsync({
                  pageId,
                  channelType: "webhook",
                  webhookUrl: values.webhookUrl,
                  name: values.name || null,
                  headers: values.headers,
                  componentIds: values.componentIds,
                });
              }
            }}
          >
            <Button variant="outline" size="sm">
              <Plus className="mr-1 size-3.5" /> {t("add")}
            </Button>
          </FormSheetSubscriber>
        </SectionHeaderRow>
      </Section>
      <Section>
        {subscriberData.length ? (
          <DataTable
            columns={columns}
            data={subscriberData}
            toolbarComponent={SubscribersDataTableToolbar}
            paginationComponent={DataTablePaginationSimple}
            defaultColumnFilters={[{ id: "status", value: ["active"] }]}
          />
        ) : (
          <EmptyStateContainer>
            <EmptyStateTitle>{t("emptyTitle")}</EmptyStateTitle>
            <EmptyStateDescription>{t("emptyDescription")}</EmptyStateDescription>
          </EmptyStateContainer>
        )}
      </Section>
    </SectionGroup>
  );
}
