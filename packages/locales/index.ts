import type { Locale as DateFnsLocale } from "date-fns/locale";
import { de, enUS, fr, hi, tr, zhCN } from "date-fns/locale";

export const locales = ["en", "fr", "de", "tr", "hi", "zh"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localeDetails: Record<Locale, { name: string; flag: string }> = {
  en: { name: "English", flag: "\uD83C\uDDFA\uD83C\uDDF8" },
  fr: { name: "Fran\u00E7ais", flag: "\uD83C\uDDEB\uD83C\uDDF7" },
  de: { name: "Deutsch", flag: "\uD83C\uDDE9\uD83C\uDDEA" },
  tr: { name: "T\u00FCrk\u00E7e", flag: "\uD83C\uDDF9\uD83C\uDDF7" },
  hi: { name: "\u0939\u093F\u0928\u094D\u0926\u0940", flag: "\uD83C\uDDEE\uD83C\uDDF3" },
  zh: { name: "\u4E2D\u6587", flag: "\uD83C\uDDE8\uD83C\uDDF3" },
};

export const dateFnsLocales: Record<Locale, DateFnsLocale> = {
  en: enUS,
  fr,
  de,
  tr,
  hi,
  zh: zhCN,
};
