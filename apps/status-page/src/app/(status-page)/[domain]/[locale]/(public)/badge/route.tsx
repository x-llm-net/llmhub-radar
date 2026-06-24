import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

import { getQueryClient, trpc } from "@/lib/trpc/server";

type Status =
  | "operational"
  | "degraded_performance"
  | "partial_outage"
  | "major_outage"
  | "under_maintenance"
  | "unknown"
  | "incident";

async function getStatus(slug: string): Promise<{ status: Status }> {
  const queryClient = getQueryClient();
  const page = await queryClient.fetchQuery(
    trpc.statusPage.getLight.queryOptions({ slug }),
  );

  if (!page) return { status: "unknown" };

  const hasActiveIncident = page.incidents.some((incident) => !incident.resolvedAt);
  if (hasActiveIncident) {
    return { status: "incident" };
  }

  const hasActiveReport = page.statusReports.some((report) => {
    const latest = report.statusReportUpdates[0];
    return latest && latest.status !== "resolved";
  });

  if (hasActiveReport) {
    return { status: "degraded_performance" };
  }

  const hasActiveMaintenance = page.maintenances.some((maintenance) => {
    const now = new Date();
    return maintenance.from <= now && maintenance.to >= now;
  });

  if (hasActiveMaintenance) {
    return { status: "under_maintenance" };
  }

  const hasErrorMonitor = page.monitors.some((monitor) => monitor.status === "error");
  if (hasErrorMonitor) {
    return { status: "major_outage" };
  }

  const hasDegradedMonitor = page.monitors.some(
    (monitor) => monitor.status === "degraded",
  );
  if (hasDegradedMonitor) {
    return { status: "degraded_performance" };
  }

  const hasActiveMonitor = page.monitors.some((monitor) => monitor.status === "active");
  switch (hasActiveMonitor ? "success" : "unknown") {
    case "success":
      return { status: "operational" };
    default:
      return { status: "unknown" };
  }
}

// Keep the `label` size within a maximum of 'Operational' to stay within the `SIZE` restriction
const statusDictionary = {
  en: {
    operational: {
      label: "Operational",
      color: "bg-green-500",
    },
    degraded_performance: {
      label: "Degraded",
      color: "bg-yellow-500",
    },
    partial_outage: {
      label: "Outage",
      color: "bg-yellow-500",
    },
    major_outage: {
      label: "Outage",
      color: "bg-red-500",
    },
    unknown: {
      label: "Unknown",
      color: "bg-gray-500",
    },
    incident: {
      label: "Incident",
      color: "bg-yellow-500",
    },
    under_maintenance: {
      label: "Maintenance",
      color: "bg-blue-500",
    },
  },
  zh: {
    operational: {
      label: "正常",
      color: "bg-green-500",
    },
    degraded_performance: {
      label: "降级",
      color: "bg-yellow-500",
    },
    partial_outage: {
      label: "中断",
      color: "bg-yellow-500",
    },
    major_outage: {
      label: "故障",
      color: "bg-red-500",
    },
    unknown: {
      label: "未知",
      color: "bg-gray-500",
    },
    incident: {
      label: "事件中",
      color: "bg-yellow-500",
    },
    under_maintenance: {
      label: "维护中",
      color: "bg-blue-500",
    },
  },
} as const satisfies Record<
  "en" | "zh",
  Record<Status, { label: string; color: string }>
>;

// const SIZE = { width: 120, height: 34 };
const SIZE: Record<string, { width: number; height: number }> = {
  sm: { width: 120, height: 34 },
  md: { width: 160, height: 46 },
  lg: { width: 200, height: 56 },
  xl: { width: 240, height: 68 },
};
export async function GET(
  req: NextRequest,
  props: { params: Promise<{ domain: string; locale: string }> },
) {
  const params = await props.params;
  const { status } = await getStatus(params.domain);
  const locale = params.locale === "zh" ? "zh" : "en";
  const theme = req.nextUrl.searchParams.get("theme");
  const size = req.nextUrl.searchParams.get("size");
  const s = SIZE[size ?? "sm"] ?? SIZE.sm;
  const { label, color } = statusDictionary[locale][status];
  const light = "border-gray-200 text-gray-700 bg-white";
  const dark = "border-gray-800 text-gray-300 bg-gray-900";

  return new ImageResponse(
    <div
      tw={`flex items-center justify-center rounded-md border px-3 py-1
        ${size === "sm" && "text-sm"}${size === "md" && "text-md"} ${
          size === "lg" && "text-lg"
        } ${size === "xl" && "text-xl"} ${!size && "text-sm"} ${
          theme === "dark" ? dark : light
        }`}
      style={{ ...s }}
    >
      {label}
      <div tw={`flex h-2 w-2 rounded-full ml-2 ${color}`} />
    </div>,
    { ...s },
  );
}
