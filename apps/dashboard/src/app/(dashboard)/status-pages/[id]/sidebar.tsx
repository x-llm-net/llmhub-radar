"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@openstatus/ui/components/ui/tooltip";
import { useCopyToClipboard } from "@openstatus/ui/hooks/use-copy-to-clipboard";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";

import { Link } from "@/components/common/link";
import { TableCellLink } from "@/components/data-table/table-cell-link";
import { SidebarRight } from "@/components/nav/sidebar-right";
import { useTRPC } from "@/lib/trpc/client";

export function Sidebar() {
  const t = useTranslations("statusPages.sidebar");
  const common = useTranslations("common");
  const { id } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const { data: statusPage } = useQuery(
    trpc.page.get.queryOptions({ id: Number.parseInt(id) }),
  );
  const { copy } = useCopyToClipboard();

  if (!statusPage) return null;

  const BADGE_URL = `https://${statusPage.slug}.openstatus.dev/badge/v2`;

  return (
    <SidebarRight
      header={t("header")}
      metadata={[
        {
          label: t("overview"),
          items: [
            {
              label: t("slug"),
              value: (
                <Link
                  href={`https://${
                    statusPage.customDomain ||
                    `${statusPage.slug}.openstatus.dev`
                  }`}
                  target="_blank"
                >
                  {statusPage.slug}
                </Link>
              ),
            },
            {
              label: t("accessType"),
              value: statusPage.accessType,
            },
            { label: t("domain"), value: statusPage.customDomain || "-" },
            {
              label: t("favicon"),
              value: statusPage.icon ? (
                <div className="bg-muted size-4 overflow-hidden rounded border">
                  <img src={statusPage.icon} alt={t("favicon")} />
                </div>
              ) : (
                "-"
              ),
            },
            {
              label: t("badge"),
              value: (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger className="align-middle">
                      <img
                        className="h-5 rounded-sm border"
                        src={BADGE_URL}
                        alt={t("badge")}
                      />
                    </TooltipTrigger>
                    <TooltipContent
                      className="cursor-pointer"
                      side="left"
                      onClick={() => copy(BADGE_URL, { withToast: true })}
                    >
                      {BADGE_URL}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ),
            },
          ],
        },
        {
          label: t("configuration"),
          items: [
            {
              label: t("theme"),
              value: statusPage.configuration?.theme ?? "-",
            },
            {
              label: t("barValue"),
              value: statusPage.configuration?.type ?? "-",
            },
            {
              label: t("cardValue"),
              value: statusPage.configuration?.value ?? "-",
            },
            {
              label: t("showUptime"),
              value: statusPage.configuration?.uptime
                ? common("yes")
                : common("no"),
            },
          ],
        },
        {
          label: t("monitors"),
          emptyMessage: t("noMonitors"),
          items: statusPage.pageComponents.flatMap((component) => {
            const arr = [];
            arr.push({
              label: t("name"),
              value: (
                <TableCellLink
                  href={`/status-pages/${statusPage.id}/components`}
                  value={component.name}
                />
              ),
            });
            arr.push({
              label: t("type"),
              value: component.type,
              isNested: true,
            });
            return arr;
          }),
        },
      ]}
      footerButton={{
        onClick: () =>
          typeof window !== "undefined" &&
          window.open(
            `https://${
              statusPage.customDomain || `${statusPage.slug}.openstatus.dev`
            }`,
            "_blank",
          ),
        children: (
          <>
            <ExternalLink />
            <span>{t("visitPage")}</span>
          </>
        ),
      }}
    />
  );
}
