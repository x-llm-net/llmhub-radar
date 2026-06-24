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

const statusDictionary = {
  en: {
    operational: {
      label: "All Systems Operational",
      hexColor: "#10b981",
    },
    degraded_performance: {
      label: "Degraded Performance",
      hexColor: "#f59e0b",
    },
    partial_outage: {
      label: "Partial Outage",
      hexColor: "#f59e0b",
    },
    major_outage: {
      label: "Major Outage",
      hexColor: "#ef4444",
    },
    unknown: {
      label: "Unknown",
      hexColor: "#6b7280",
    },
    incident: {
      label: "Ongoing Incident",
      hexColor: "#f59e0b",
    },
    under_maintenance: {
      label: "Under Maintenance",
      hexColor: "#3b82f6",
    },
  },
  zh: {
    operational: {
      label: "系统运行正常",
      hexColor: "#10b981",
    },
    degraded_performance: {
      label: "服务降级",
      hexColor: "#f59e0b",
    },
    partial_outage: {
      label: "部分中断",
      hexColor: "#f59e0b",
    },
    major_outage: {
      label: "严重中断",
      hexColor: "#ef4444",
    },
    unknown: {
      label: "未知",
      hexColor: "#6b7280",
    },
    incident: {
      label: "事件处理中",
      hexColor: "#f59e0b",
    },
    under_maintenance: {
      label: "维护中",
      hexColor: "#3b82f6",
    },
  },
} as const satisfies Record<
  "en" | "zh",
  Record<Status, { label: string; hexColor: string }>
>;

const SIZE: Record<
  string,
  {
    height: number;
    padding: number;
    gap: number;
    radius: number;
    fontSize: number;
  }
> = {
  sm: { height: 34, padding: 8, gap: 12, radius: 4, fontSize: 12 },
  md: { height: 46, padding: 8, gap: 12, radius: 4, fontSize: 14 },
  lg: { height: 56, padding: 12, gap: 16, radius: 6, fontSize: 16 },
  xl: { height: 68, padding: 12, gap: 16, radius: 6, fontSize: 18 },
};

function getTextWidth(text: string, fontSize: number): number {
  const monoCharWidthRatio = 0.6;
  return text.length * monoCharWidthRatio * fontSize;
}

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ domain: string; locale: string }> },
) {
  const params = await props.params;
  const { status } = await getStatus(params.domain);
  const locale = params.locale === "zh" ? "zh" : "en";
  const theme = req.nextUrl.searchParams.get("theme") ?? "light";
  const variant = req.nextUrl.searchParams.get("variant") ?? "default";
  const size = req.nextUrl.searchParams.get("size") ?? "sm";

  const { height, padding, gap, radius, fontSize } = SIZE[size] ?? SIZE.sm;
  const { label, hexColor } = statusDictionary[locale][status];
  const textWidth = getTextWidth(label, fontSize);
  const width = Math.ceil(padding + textWidth + gap + radius * 2 + padding);

  const textColor = theme === "dark" ? "#d1d5db" : "#374151";
  const bgColor = theme === "dark" ? "#111827" : "#ffffff";
  const borderColor = variant === "outline" ? "#d1d5db" : "transparent";

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="0.5" y="0.5" width="${width - 1}" height="${
      height - 1
    }"  fill="${bgColor}" stroke="${borderColor}" stroke-width="1" rx="${radius}" ry="${radius}" />
      <text x="${padding}" y="50%" dominant-baseline="middle"
            font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" font-size="${fontSize}" font-weight="600" fill="${textColor}">
        ${label}
      </text>
      <circle cx="${width - padding - radius}" cy="${
        height / 2
      }" r="${radius}" fill="${hexColor}"/>
    </svg>
  `;

  return new Response(svg, {
    headers: { "Content-Type": "image/svg+xml" },
  });
}
