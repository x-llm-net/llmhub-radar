"use client";

import type { RouterOutputs } from "@openstatus/api";
import { useTranslations } from "next-intl";

import {
  ChangesTable,
  buildAuditLogChangeRows,
} from "@/components/common/changes-table";
import { CopyRow } from "@/components/common/copy-row";

type AuditLog = RouterOutputs["auditLog"]["list"]["items"][number];

export function DataTableRowDetails({ row }: { row: AuditLog }) {
  const t = useTranslations("settings.auditLogs");
  const changes = buildAuditLogChangeRows(row);

  return (
    <div className="bg-muted/30 p-4">
      {changes.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="col-span-2 flex flex-col gap-2">
            <div className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              {t("changes")}
            </div>
            <ChangesTable changes={changes} />
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              {t("entry")}
            </div>
            <dl className="flex flex-col gap-1.5">
              <CopyRow label={t("entityType")} value={row.entityType} />
              <CopyRow label={t("entityId")} value={row.entityId} />
              <CopyRow label={t("actorType")} value={row.actorType} />
              <CopyRow label={t("actorId")} value={row.actorId} />
              {row.user?.name ? (
                <CopyRow label={t("userName")} value={row.user.name} />
              ) : null}
              {row.user?.email ? (
                <CopyRow label={t("userEmail")} value={row.user.email} />
              ) : null}
            </dl>
          </div>
        </div>
      ) : null}
    </div>
  );
}
