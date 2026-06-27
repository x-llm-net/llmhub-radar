"use client";

import { Badge } from "@openstatus/ui/components/ui/badge";
import { cn } from "@openstatus/ui/lib/utils";
import { Clock } from "lucide-react";
import type * as React from "react";

export type RadarServiceCardMetric = {
  label: string;
  value: string;
  hint: string;
  valueClassName?: string;
};

export type RadarServiceCardRunSlot = {
  key: string | number;
  toneClassName: string;
  errorType: string;
  firstToken: string;
  httpStatus: string | number;
  result: string;
  time: string;
} | null;

export type RadarServiceCardProps = {
  actions?: React.ReactNode;
  className?: string;
  footer: {
    interval: string;
    intervalTitle: string;
    lastCheck: string;
  };
  meta?: React.ReactNode;
  metrics: RadarServiceCardMetric[];
  models?: {
    countLabel: string;
    emptyLabel: string;
    label: string;
    values: string[];
  };
  status: {
    className?: string;
    label: string;
  };
  timeline: {
    pastLabel: string;
    recentLabel: string;
    runs: RadarServiceCardRunSlot[];
    samplesLabel: string;
    nowLabel: string;
  };
  title: string;
};

export function RadarServiceCard({
  actions,
  className,
  footer,
  meta,
  metrics,
  models,
  status,
  timeline,
  title,
}: RadarServiceCardProps) {
  return (
    <div
      data-radar-service-card
      className={cn(
        "bg-background group/card flex h-full flex-col rounded-lg border p-4 shadow-sm",
        className,
      )}
    >
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <h3
            className="min-w-0 flex-1 truncate text-xl leading-7 font-semibold"
            title={title}
          >
            {title}
          </h3>
          <div className="grid min-h-7 shrink-0 items-center justify-items-end">
            <Badge
              variant="outline"
              className={cn(
                "col-start-1 row-start-1 shrink-0 transition-opacity",
                actions &&
                  "group-focus-within/card:opacity-0 group-hover/card:opacity-0",
                status.className,
              )}
            >
              {status.label}
            </Badge>
            {actions ? (
              <div className="pointer-events-none col-start-1 row-start-1 flex items-center gap-1 opacity-0 transition-opacity group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100 group-hover/card:pointer-events-auto group-hover/card:opacity-100">
                {actions}
              </div>
            ) : null}
          </div>
        </div>
        {meta ? (
          <div className="text-muted-foreground flex min-w-0 items-center gap-2 overflow-hidden text-xs">
            {meta}
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-[1.12fr_1fr_1fr] gap-2">
        {metrics.map((metric) => (
          <RadarMetric key={metric.label} {...metric} />
        ))}
      </div>

      <div className="mt-4 border-t pt-4 pb-2">
        <div className="mb-2 flex items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">{timeline.recentLabel}</span>
          <span className="text-muted-foreground">{timeline.samplesLabel}</span>
        </div>
        <div className="flex h-8 min-w-0 items-center gap-px">
          {timeline.runs.map((run, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed historical slots can be empty.
              key={run?.key ?? `empty-${index}`}
              data-radar-probe
              data-probe-error={run?.errorType}
              data-probe-first-token={run?.firstToken}
              data-probe-http={run?.httpStatus}
              data-probe-result={run?.result}
              data-probe-time={run?.time}
              className={cn(
                "h-5 min-w-0 flex-1 rounded-[2px] transition-[height,filter,opacity] hover:h-6 hover:opacity-90 hover:brightness-110",
                run?.toneClassName ?? "bg-muted",
              )}
            />
          ))}
        </div>
        <div className="text-muted-foreground mt-1 flex justify-between text-[10px] tracking-normal uppercase">
          <span>{timeline.pastLabel}</span>
          <span>{timeline.nowLabel}</span>
        </div>
      </div>

      {models ? (
        <div className="mt-4 grid gap-1.5 border-t pt-4">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">{models.label}</span>
            <span className="text-muted-foreground">{models.countLabel}</span>
          </div>
          <div
            data-radar-card-models
            className="max-h-[calc(3*1.5rem+2*0.375rem+0.5rem)] overflow-y-auto pr-1 pb-2"
          >
            {models.values.length > 0 ? (
              <div className="flex flex-wrap content-start gap-1.5">
                {models.values.map((model) => (
                  <Badge
                    key={model}
                    variant="outline"
                    className="h-6 max-w-full font-mono whitespace-nowrap"
                  >
                    <span className="min-w-0 truncate">{model}</span>
                  </Badge>
                ))}
              </div>
            ) : (
              <span className="text-muted-foreground text-sm">
                {models.emptyLabel}
              </span>
            )}
          </div>
        </div>
      ) : null}

      <div
        data-radar-card-footer
        className="text-muted-foreground mt-auto flex items-center justify-between gap-4 border-t pt-3.5 text-xs"
      >
        <span
          className="text-foreground inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap"
          title={footer.intervalTitle}
        >
          <Clock className="text-muted-foreground size-3.5" />
          {footer.interval}
        </span>
        <span className="min-w-0 truncate text-right">{footer.lastCheck}</span>
      </div>
    </div>
  );
}

function RadarMetric({
  label,
  value,
  hint,
  valueClassName,
}: RadarServiceCardMetric) {
  return (
    <div className="bg-background/60 flex h-[5.25rem] min-w-0 flex-col justify-center gap-1.5 rounded-lg border px-2 py-2">
      <div className="text-muted-foreground truncate text-[11px] leading-none whitespace-nowrap">
        {label}
      </div>
      <div className="space-y-1">
        <RadarMetricValue value={value} valueClassName={valueClassName} />
        <div className="text-muted-foreground truncate text-[11px] leading-tight">
          {hint}
        </div>
      </div>
    </div>
  );
}

function RadarMetricValue({
  value,
  valueClassName,
}: {
  value: string;
  valueClassName?: string;
}) {
  const percentValue = value.endsWith("%");
  const secondValue = value.endsWith("s") && !value.endsWith("ms");

  return (
    <div
      className={cn(
        "leading-none font-semibold tracking-normal whitespace-nowrap tabular-nums",
        valueClassName,
      )}
    >
      {percentValue ? (
        <>
          <span className="text-xl">{value.slice(0, -1)}</span>
          <span className="text-xs">%</span>
        </>
      ) : secondValue ? (
        <>
          <span className="text-xl">{value.slice(0, -1)}</span>
          <span className="text-xs">s</span>
        </>
      ) : (
        <span className="text-xl">{value}</span>
      )}
    </div>
  );
}
