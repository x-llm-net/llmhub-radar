export type EmailLocale = "en" | "zh";

export function normalizeEmailLocale(locale?: string | null): EmailLocale {
  return locale?.toLowerCase().startsWith("zh") ? "zh" : "en";
}
