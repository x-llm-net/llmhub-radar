"use client";

import { format } from "date-fns";
import { useLocale } from "next-intl";

import { HoverCardTimestamp } from "@/components/common/hover-card-timestamp";
import { cn } from "@/lib/utils";

export function TableCellDate({
  value,
  className,
  formatStr,
  ...props
}: React.ComponentProps<"div"> & { value: unknown; formatStr?: string }) {
  const locale = useLocale();

  if (value instanceof Date) {
    const formattedValue = formatStr
      ? format(value, formatStr)
      : new Intl.DateTimeFormat(locale, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(value);

    return (
      <HoverCardTimestamp date={value}>
        <div className={cn("text-muted-foreground", className)} {...props}>
          {formattedValue}
        </div>
      </HoverCardTimestamp>
    );
  }
  if (typeof value === "string") {
    return (
      <div className={cn("text-muted-foreground", className)} {...props}>
        {value}
      </div>
    );
  }
  return (
    <div className={cn("text-muted-foreground", className)} {...props}>
      -
    </div>
  );
}
