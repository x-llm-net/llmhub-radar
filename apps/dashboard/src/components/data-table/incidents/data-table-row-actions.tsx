"use client";

import type { RouterOutputs } from "@openstatus/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@openstatus/ui/components/ui/alert-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Row } from "@tanstack/react-table";
import { isTRPCClientError } from "@trpc/client";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { QuickActions } from "@/components/dropdowns/quick-actions";
import { getActions } from "@/data/incidents.client";
import { useTRPC } from "@/lib/trpc/client";

type Incident = RouterOutputs["incident"]["list"][number];

interface DataTableRowActionsProps {
  row: Row<Incident>;
}

export function DataTableRowActions({ row }: DataTableRowActionsProps) {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("monitors.incidents");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const acknowledgeIncidentMutation = useMutation(
    trpc.incident.acknowledge.mutationOptions({
      onSuccess: () => {
        queryClient.refetchQueries({
          queryKey: trpc.incident.list.queryKey({
            monitorId: row.original.monitorId,
          }),
        });
      },
    }),
  );
  const resolveIncidentMutation = useMutation(
    trpc.incident.resolve.mutationOptions({
      onSuccess: () => {
        queryClient.refetchQueries({
          queryKey: trpc.incident.list.queryKey({
            monitorId: row.original.monitorId,
          }),
        });
      },
    }),
  );
  const deleteIncidentMutation = useMutation(
    trpc.incident.delete.mutationOptions({
      onSuccess: () => {
        queryClient.refetchQueries({
          queryKey: trpc.incident.list.queryKey({
            monitorId: row.original.monitorId,
          }),
        });
      },
    }),
  );

  const [type, setType] = useState<"acknowledge" | "resolve" | null>(null);
  const open = useMemo(() => type !== null, [type]);

  const actions = getActions(
    {
      acknowledge: row.original.acknowledgedAt
        ? undefined
        : () => setType("acknowledge"),
      resolve: row.original.resolvedAt ? undefined : () => setType("resolve"),
    },
    {
      acknowledge: t("actions.acknowledge"),
      resolve: t("actions.resolve"),
      delete: t("actions.delete"),
    },
  );

  const handleConfirm = async () => {
    try {
      startTransition(async () => {
        const promise =
          type === "acknowledge"
            ? acknowledgeIncidentMutation.mutateAsync({
                id: row.original.id,
              })
            : resolveIncidentMutation.mutateAsync({
                id: row.original.id,
              });
        toast.promise(promise, {
          loading: t("confirming"),
          success: t("confirmed"),
          error: (error) => {
            if (isTRPCClientError(error)) {
              return error.message;
            }
            return t("failedToConfirm");
          },
        });
        await promise;
        setType(null);
      });
    } catch (error) {
      console.error("Failed to confirm:", error);
    }
  };

  return (
    <>
      <QuickActions
        actions={actions}
        deleteAction={{
          confirmationValue: row.original.title || t("incidentFallback"),
          submitAction: async () => {
            await deleteIncidentMutation.mutateAsync({
              id: row.original.id,
            });
          },
        }}
      />
      <AlertDialog open={open} onOpenChange={() => setType(null)}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // NOTE: bug where the body is not clickable after closing the alert dialog
            event.preventDefault();
            document.body.style.pointerEvents = "";
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.rich("confirmDescription", {
                action: type ? t(`actions.${type}`) : "",
                strong: (chunks) => (
                  <span className="font-semibold">{chunks}</span>
                ),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirm();
              }}
              disabled={isPending}
            >
              {isPending ? t("confirming") : t("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
