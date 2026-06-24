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

import { QuickActions } from "@/components/dropdowns/quick-actions";
import { formatDate } from "@/lib/formatter";
import { useTRPC } from "@/lib/trpc/client";

export function DataTable() {
  const t = useTranslations("settings.forms");
  const trpc = useTRPC();
  const { data: members, refetch } = useQuery(trpc.member.list.queryOptions());
  const deleteMemberMutation = useMutation(
    trpc.member.delete.mutationOptions({
      onSuccess: () => refetch(),
    }),
  );

  if (!members) return null;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("name")}</TableHead>
          <TableHead>{t("email")}</TableHead>
          <TableHead>{t("role")}</TableHead>
          <TableHead>{t("created")}</TableHead>
          <TableHead>
            <span className="sr-only">{t("actions")}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((item) => (
          <TableRow key={item.user.id}>
            <TableCell>
              {item.user.name ?? (
                <span className="text-muted-foreground">-</span>
              )}
            </TableCell>
            <TableCell>{item.user.email}</TableCell>
            <TableCell>{item.role}</TableCell>
            <TableCell>
              {formatDate(item.user.createdAt ?? item.createdAt)}
            </TableCell>
            <TableCell>
              <div className="flex justify-end">
                <QuickActions
                  deleteAction={{
                    confirmationValue: item.user.email ?? "user",
                    // FIXME: when deleting myself, throws an error, should have been caught by the toast.error
                    submitAction: async () =>
                      await deleteMemberMutation.mutateAsync({
                        id: item.user.id,
                      }),
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
