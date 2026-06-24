"use client";

import { deserialize } from "@openstatus/assertions";
import { Badge } from "@openstatus/ui/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Logs } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";

import { TableCellLink } from "@/components/data-table/table-cell-link";
import { SidebarRight } from "@/components/nav/sidebar-right";
import { monitorTypes } from "@/data/monitors.client";
import { formatMilliseconds } from "@/lib/formatter";
import { useTRPC } from "@/lib/trpc/client";

export function Sidebar() {
  const t = useTranslations("monitors.sidebar");
  const common = useTranslations("common");
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const { data: monitor } = useQuery(
    trpc.monitor.get.queryOptions({ id: Number.parseInt(id) }),
  );

  if (!monitor) return null;

  const assertions = monitor.assertions ? deserialize(monitor.assertions) : [];
  const type = monitorTypes.find((type) => type.id === monitor.jobType);

  return (
    <SidebarRight
      header={t("header")}
      metadata={[
        {
          label: t("overview"),
          items: [
            {
              label: t("externalName"),
              value: monitor.externalName || monitor.name,
            },
            {
              label: t("status"),
              // FIXME: dynamic
              value: <span className="text-success">{t("normal")}</span>,
            },
            {
              label: t("type"),
              value: type ? (
                <span className="flex items-center gap-1">
                  <span className="uppercase">{type.label}</span>
                  <type.icon className="text-muted-foreground h-2.5 w-2.5" />
                </span>
              ) : (
                <span className="uppercase">{monitor.jobType}</span>
              ),
            },
            {
              label: t("endpoint"),
              value: monitor.url.replace(/^https?:\/\//, ""),
            },
            {
              label: t("regions"),
              value:
                monitor.regions.length > 6
                  ? t("regionsCount", { count: monitor.regions.length })
                  : monitor.regions.join(", "),
            },
            {
              label: t("tags"),
              value: (
                <div className="group/badges flex flex-wrap -space-x-2">
                  {monitor.tags.map((tag) => (
                    <Badge
                      key={tag.id}
                      variant="outline"
                      className="bg-background relative flex translate-x-0 items-center gap-1.5 rounded-full transition-transform hover:z-10 hover:translate-x-1"
                    >
                      <div
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      {tag.name}
                    </Badge>
                  ))}
                </div>
              ),
            },
          ],
        },
        {
          label: t("configuration"),
          items: [
            { label: t("periodicity"), value: monitor.periodicity },
            {
              label: t("timeout"),
              value: formatMilliseconds(monitor.timeout),
            },
            {
              label: t("public"),
              value: monitor.public ? common("yes") : common("no"),
            },
            {
              label: t("active"),
              value: monitor.active ? common("yes") : common("no"),
            },
            {
              label: t("followRedirects"),
              value: monitor.followRedirects ? common("yes") : common("no"),
            },
          ],
        },
        {
          label: t("notifications"),
          emptyMessage: t("noNotifications"),
          items: monitor.notifications.flatMap((notification) => {
            const arr = [];
            arr.push({
              label: t("name"),
              value: (
                <TableCellLink
                  // TODO: add the ?id= to the href and open the sheet
                  href={"/notifications"}
                  value={notification.name}
                />
              ),
            });
            arr.push({
              label: t("type"),
              value: notification.provider,
              isNested: true,
            });
            arr.push({
              label: t("value"),
              value: notification.data, // TODO: improve this based on the provider - we might wanna parse it!
              isNested: true,
            });
            return arr;
          }),
        },
        {
          label: t("assertions"),
          emptyMessage: t("noAssertions"),
          items: assertions.flatMap((assertion) => {
            const arr = [];

            arr.push({
              label: t("type"),
              value: assertion.schema.type,
            });

            arr.push({
              label: t("compare"),
              value: assertion.schema.compare,
              isNested: true,
            });

            if (
              (assertion.schema.type === "header" ||
                assertion.schema.type === "dnsRecord") &&
              assertion.schema.key
            ) {
              arr.push({
                label: t("key"),
                value: assertion.schema.key,
                isNested: true,
              });
            }

            arr.push({
              label: t("value"),
              value: assertion.schema.target,
              isNested: true,
            });

            return arr;
          }),
        },
        // {
        //   label: "Last Logs",
        //   items: [
        //     ...Array.from({ length: 20 }).map((_, index) => {
        //       const date = new Date(new Date().getTime() - index * 500000);
        //       return {
        //         label: [
        //           "Amsterdam",
        //           "Frankfurt",
        //           "New York",
        //           "Singapore",
        //           "Johannesburg",
        //         ][index % 5],
        //         value: (
        //           <div className="flex items-center justify-between gap-2">
        //             <CircleCheck className="h-4 w-4 text-success" />
        //             <TooltipProvider>
        //               <Tooltip>
        //                 <TooltipTrigger>
        //                   <span className="underline decoration-muted-foreground/50 decoration-dashed underline-offset-2">
        //                     {date.toLocaleTimeString("en-US", {
        //                       hour: "2-digit",
        //                       minute: "2-digit",
        //                     })}
        //                   </span>
        //                 </TooltipTrigger>
        //                 <TooltipContent align="center" side="left">
        //                   {date.toLocaleString("en-US")}
        //                 </TooltipContent>
        //               </Tooltip>
        //             </TooltipProvider>
        //           </div>
        //         ),
        //       };
        //     }),
        //   ],
        // },
      ]}
      footerButton={{
        onClick: () => router.push(`/monitors/${id}/logs`),
        children: (
          <>
            <Logs />
            <span>{t("viewLogs")}</span>
          </>
        ),
      }}
    />
  );
}
