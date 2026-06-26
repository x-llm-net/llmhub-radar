"use client";

import type { StatusReportStatus } from "@openstatus/db/src/schema";
import type { PageComponentImpact } from "@openstatus/db/src/schema/page_components/constants";
import { useTranslations } from "next-intl";

import type {
  PageComponentImpactLabels,
  StatusReportImpactLabels,
  StatusReportStatusLabels,
} from "@/data/status-report-updates.client";

export function useStatusReportLabels() {
  const statusT = useTranslations("statusPages.reports.statuses");
  const impactT = useTranslations("statusPages.reports.impacts");

  const statusLabels = {
    investigating: statusT("investigating"),
    identified: statusT("identified"),
    monitoring: statusT("monitoring"),
    resolved: statusT("resolved"),
  } satisfies StatusReportStatusLabels;

  const componentImpactLabels = {
    operational: impactT("operational"),
    degraded_performance: impactT("degradedPerformance"),
    partial_outage: impactT("partialOutage"),
    major_outage: impactT("majorOutage"),
  } satisfies PageComponentImpactLabels;

  const impactLabels = {
    ...componentImpactLabels,
    untriaged: impactT("untriaged"),
  } satisfies StatusReportImpactLabels;

  return {
    statusLabel: (status: StatusReportStatus) => statusLabels[status],
    impactLabel: (impact: PageComponentImpact | "untriaged") =>
      impactLabels[impact],
    statusLabels,
    componentImpactLabels,
    impactLabels,
  };
}
