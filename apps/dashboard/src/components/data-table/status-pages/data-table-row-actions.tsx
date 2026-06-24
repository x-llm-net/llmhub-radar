"use client";

import type { RouterOutputs } from "@openstatus/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Row } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { QuickActions } from "@/components/dropdowns/quick-actions";
import { getActions } from "@/data/status-pages.client";
import { useTRPC } from "@/lib/trpc/client";

type StatusPage = RouterOutputs["page"]["list"][number];

interface DataTableRowActionsProps {
  row: Row<StatusPage>;
}

export function DataTableRowActions({ row }: DataTableRowActionsProps) {
  const t = useTranslations("statusPages");
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const deleteStatusPageMutation = useMutation(
    trpc.page.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.page.list.queryKey(),
        });
      },
    }),
  );
  const actions = getActions({
    edit: () => router.push(`/status-pages/${row.original.id}/edit`),
    "copy-id": () => {
      navigator.clipboard.writeText(row.original.id.toString());
      toast.success(t("nav.copiedId"));
    },
  }, {
    edit: t("actions.settings"),
    "copy-id": t("actions.copyId"),
    delete: t("actions.delete"),
  });

  return (
    <QuickActions
      actions={actions}
      deleteAction={{
        confirmationValue: row.original.title ?? t("nav.deleteFallback"),
        submitAction: async () => {
          await deleteStatusPageMutation.mutateAsync({
            id: row.original.id,
          });
        },
      }}
    />
  );
}
