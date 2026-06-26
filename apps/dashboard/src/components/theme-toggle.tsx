"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openstatus/ui/components/ui/select";
import { cn } from "@openstatus/ui/lib/utils";
import { Laptop, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import type * as React from "react";
import { useState } from "react";
import { useEffect } from "react";

export function ThemeToggle({
  className,
  ...props
}: React.ComponentProps<typeof SelectTrigger>) {
  const { setTheme, theme } = useTheme();
  const t = useTranslations("nav");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // NOTE: hydration error if we don't do this
  if (!mounted) {
    return (
      <Select>
        <SelectTrigger className={cn("w-[180px]", className)} {...props}>
          <SelectValue placeholder={t("theme")} />
        </SelectTrigger>
      </Select>
    );
  }

  return (
    <Select value={theme} onValueChange={setTheme}>
      <SelectTrigger className={cn("w-[180px]", className)} {...props}>
        <SelectValue defaultValue={theme} placeholder={t("theme")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="light">
          <div className="flex items-center gap-2">
            <Sun className="h-4 w-4" />
            <span>{t("themeLight")}</span>
          </div>
        </SelectItem>
        <SelectItem value="dark">
          <div className="flex items-center gap-2">
            <Moon className="h-4 w-4" />
            <span>{t("themeDark")}</span>
          </div>
        </SelectItem>
        <SelectItem value="system">
          <div className="flex items-center gap-2">
            <Laptop className="h-4 w-4" />
            <span>{t("themeSystem")}</span>
          </div>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
