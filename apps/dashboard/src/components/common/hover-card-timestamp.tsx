"use client";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@openstatus/ui/components/ui/hover-card";
import { useLocale, useTranslations } from "next-intl";
import type { ComponentPropsWithoutRef } from "react";

import { CopyRow } from "./copy-row";

// TODO: move to TableCellDate?

type HoverCardContentProps = ComponentPropsWithoutRef<typeof HoverCardContent>;

interface HoverCardTimestampProps {
  date: Date;
  side?: HoverCardContentProps["side"];
  sideOffset?: HoverCardContentProps["sideOffset"];
  align?: HoverCardContentProps["align"];
  alignOffset?: HoverCardContentProps["alignOffset"];
  children?: React.ReactNode;
}

export function HoverCardTimestamp({
  date,
  side = "right",
  align = "start",
  alignOffset = -4,
  sideOffset,
  children,
}: HoverCardTimestampProps) {
  const t = useTranslations("common");
  const locale = useLocale();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dateTimeOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };
  const formatDateTime = (timeZone?: string) =>
    new Intl.DateTimeFormat(locale, {
      ...dateTimeOptions,
      timeZone,
    }).format(date);

  return (
    <HoverCard openDelay={0} closeDelay={0}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        className="z-10 w-auto p-2"
        {...{ side, align, alignOffset, sideOffset }}
      >
        <dl className="flex flex-col gap-1">
          <CopyRow value={String(date.getTime())} label={t("timestamp")} />
          <CopyRow value={formatDateTime("UTC")} label="UTC" />
          <CopyRow value={formatDateTime(timezone)} label={timezone} />
          <CopyRow value={formatRelativeTime(date, locale)} label={t("relative")} />
        </dl>
      </HoverCardContent>
    </HoverCard>
  );
}

function formatRelativeTime(date: Date, locale: string) {
  const diffMs = date.getTime() - Date.now();
  const units: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
    { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
    { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
    { unit: "day", ms: 24 * 60 * 60 * 1000 },
    { unit: "hour", ms: 60 * 60 * 1000 },
    { unit: "minute", ms: 60 * 1000 },
    { unit: "second", ms: 1000 },
  ];
  const selected =
    units.find((item) => Math.abs(diffMs) >= item.ms) ??
    units[units.length - 1];

  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
    Math.round(diffMs / selected.ms),
    selected.unit,
  );
}
