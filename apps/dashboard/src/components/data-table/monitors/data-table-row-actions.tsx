"use client";

import type { RouterOutputs } from "@openstatus/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Row } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { ExportCodeDialog } from "@/components/dialogs/export-code";
import { QuickActions } from "@/components/dropdowns/quick-actions";
import { getActions } from "@/data/monitors.client";
import { useTRPC } from "@/lib/trpc/client";

type Monitor = RouterOutputs["monitor"]["list"][number];
interface DataTableRowActionsProps {
  row: Row<Monitor>;
}

export function DataTableRowActions({ row }: DataTableRowActionsProps) {
  const t = useTranslations("monitors");
  const [openDialog, setOpenDialog] = useState(false);
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const deleteMonitorMutation = useMutation(
    trpc.monitor.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries(trpc.monitor.list.queryOptions());
      },
    }),
  );
  const router = useRouter();
  const actions = getActions({
    edit: () => router.push(`/monitors/${row.original.id}/edit`),
    "copy-id": () => {
      navigator.clipboard.writeText(row.original.id.toString());
      toast.success(t("actions.copiedId"));
    },
    // export: () => setOpenDialog(true),
  }, {
    edit: t("actions.settings"),
    "copy-id": t("actions.copyId"),
    clone: t("actions.clone"),
    delete: t("actions.delete"),
  });

  return (
    <>
      <QuickActions
        actions={actions}
        deleteAction={{
          confirmationValue: row.original.name ?? t("actions.deleteFallback"),
          submitAction: async () => {
            await deleteMonitorMutation.mutateAsync({
              id: row.original.id,
            });
          },
        }}
      />
      <ExportCodeDialog open={openDialog} onOpenChange={setOpenDialog} />
    </>
  );
}
