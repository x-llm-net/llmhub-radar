import type { RouterOutputs } from "@openstatus/api";
import { useTranslations } from "next-intl";
import { Badge } from "@openstatus/ui/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openstatus/ui/components/ui/table";
import { useMutation } from "@tanstack/react-query";

import { QuickActions } from "@/components/dropdowns/quick-actions";
import { formatDate } from "@/lib/formatter";
import { useTRPC } from "@/lib/trpc/client";

type ApiKey = RouterOutputs["apiKeyRouter"]["getAll"][number];

/**
 * Map a key's `scopes` array to a single human label. v1 keys carry one
 * value (`['read']` or `['write']`); legacy rows backfilled to
 * `['write']` show as "Read & write." `'*'` is super-admin (synthesized
 * by middleware, never settable through any public API). Seeing it on
 * a row indicates someone hand-edited the DB or a bug bypassed the
 * input enum — surface drift instead of silently mislabeling it.
 */
function scopeLabel(
  scopes: ApiKey["scopes"],
  t: ReturnType<typeof useTranslations<"settings.forms">>,
): string {
  if (scopes.includes("*")) {
    if (typeof console !== "undefined") {
      console.warn(
        "[api-key table] row carries '*' scope — should never happen via the public API",
      );
    }
    return t("apiKeyScopeAdmin");
  }
  if (scopes.includes("write")) return t("apiKeyScopeReadWrite");
  if (scopes.includes("read")) return t("apiKeyScopeReadOnly");
  return t("unknown");
}

export function DataTable({
  apiKeys,
  refetch,
}: {
  apiKeys: ApiKey[];
  refetch: () => void;
}) {
  const t = useTranslations("settings.forms");
  const trpc = useTRPC();
  const revokeApiKeyMutation = useMutation(
    trpc.apiKeyRouter.revoke.mutationOptions({
      onSuccess: () => refetch(),
    }),
  );

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("name")}</TableHead>
            <TableHead>{t("description")}</TableHead>
            <TableHead>{t("prefix")}</TableHead>
            <TableHead>{t("access")}</TableHead>
            <TableHead>{t("expires")}</TableHead>
            <TableHead>
              <span className="sr-only">{t("actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {apiKeys.map((apiKey) => (
            <TableRow key={apiKey.id}>
              <TableCell className="font-medium">{apiKey.name}</TableCell>
              <TableCell className="text-muted-foreground max-w-[200px] truncate">
                {apiKey.description ?? "-"}
              </TableCell>
              <TableCell>
                <code className="text-xs">{apiKey.prefix}...</code>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">
                  {scopeLabel(apiKey.scopes, t)}
                </Badge>
              </TableCell>
              <TableCell className="text-sm">
                {apiKey.expiresAt ? formatDate(apiKey.expiresAt) : "-"}
              </TableCell>
              <TableCell>
                <div className="flex justify-end">
                  <QuickActions
                    deleteAction={{
                      confirmationValue: apiKey.name ?? t("apiKeyFallback"),
                      submitAction: async () =>
                        await revokeApiKeyMutation.mutateAsync({
                          keyId: apiKey.id,
                        }),
                    }}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
