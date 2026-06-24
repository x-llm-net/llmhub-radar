import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openstatus/ui/components/ui/table";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import {
  EmptyStateContainer,
  EmptyStateDescription,
  EmptyStateTitle,
} from "@/components/content/empty-state";
import { QuickActions } from "@/components/dropdowns/quick-actions";
import { formatDate } from "@/lib/formatter";
import { useTRPC } from "@/lib/trpc/client";

export function DataTable() {
  const t = useTranslations("settings.forms");
  const trpc = useTRPC();
  const { data: invitations, refetch } = useQuery(
    trpc.invitation.list.queryOptions(),
  );
  const deleteInvitationMutation = useMutation(
    trpc.invitation.delete.mutationOptions({
      onSuccess: () => refetch(),
    }),
  );

  if (!invitations) return null;

  if (invitations.length === 0) {
    return (
      <EmptyStateContainer>
        <EmptyStateTitle>{t("noPendingInvitations")}</EmptyStateTitle>
        <EmptyStateDescription>
          {t("noPendingInvitationsDescription")}
        </EmptyStateDescription>
      </EmptyStateContainer>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("email")}</TableHead>
          <TableHead>{t("role")}</TableHead>
          <TableHead>{t("createdAt")}</TableHead>
          <TableHead>{t("expiresAt")}</TableHead>
          <TableHead>{t("acceptedAt")}</TableHead>
          <TableHead>
            <span className="sr-only">{t("actions")}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invitations.map((item) => (
          <TableRow key={item.id}>
            <TableCell>{item.email}</TableCell>
            <TableCell>{item.role}</TableCell>
            <TableCell>
              {item.createdAt ? formatDate(item.createdAt) : "-"}
            </TableCell>
            <TableCell>{formatDate(item.expiresAt)}</TableCell>
            <TableCell>
              {item.acceptedAt ? formatDate(item.acceptedAt) : "-"}
            </TableCell>
            <TableCell>
              <div className="flex justify-end">
                <QuickActions
                  deleteAction={{
                    confirmationValue: item.email ?? t("invitationFallback"),
                    submitAction: async () =>
                      deleteInvitationMutation.mutateAsync({ id: item.id }),
                  }}
                />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
