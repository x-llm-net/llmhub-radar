"use client";

import { localeDetails, locales } from "@openstatus/locales";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@openstatus/ui/components/ui/dropdown-menu";
import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { localeCookieName } from "@/i18n/config";

export function LanguageSwitcher({
  align = "end",
  side = "bottom",
}: {
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
}) {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("language");

  function setLocale(nextLocale: string) {
    document.cookie = `${localeCookieName}=${nextLocale}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="border-border hover:bg-accent hover:text-accent-foreground inline-flex h-8 items-center gap-2 rounded-md border px-2 text-sm"
        aria-label={t("switch")}
      >
        <Languages className="size-4" />
        <span className="font-commit-mono text-xs tracking-tight">
          {locale.toUpperCase()}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side}>
        {locales.map((item) => (
          <DropdownMenuItem
            key={item}
            onClick={() => setLocale(item)}
            className="font-commit-mono tracking-tight"
          >
            <span className="w-5">{localeDetails[item].flag}</span>
            <span>{localeDetails[item].name}</span>
            {item === locale ? (
              <span className="text-muted-foreground ml-auto text-xs">
                {t("current")}
              </span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
