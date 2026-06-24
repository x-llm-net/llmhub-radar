import { defaultLocale, locales } from "@openstatus/locales";
import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

import { localeCookieName } from "./config";

function isLocale(value: string | undefined): value is (typeof locales)[number] {
  return !!value && (locales as readonly string[]).includes(value);
}

function getLocaleFromAcceptLanguage(header: string | null) {
  if (!header) return null;

  const candidates = header
    .split(",")
    .map((part) => part.trim().split(";")[0]?.toLowerCase())
    .filter(Boolean);

  for (const candidate of candidates) {
    const base = candidate?.split("-")[0];
    if (isLocale(candidate)) return candidate;
    if (isLocale(base)) return base;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function mergeMessages(
  defaults: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...defaults };

  for (const [key, value] of Object.entries(overrides)) {
    const defaultValue = merged[key];

    merged[key] =
      isRecord(defaultValue) && isRecord(value)
        ? mergeMessages(defaultValue, value)
        : value;
  }

  return merged;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookieLocale = cookieStore.get(localeCookieName)?.value;
  const locale = isLocale(cookieLocale)
    ? cookieLocale
    : (getLocaleFromAcceptLanguage(headerStore.get("accept-language")) ??
      defaultLocale);
  const defaultMessages = (await import(`../../messages/${defaultLocale}.json`))
    .default;
  const localeMessages =
    locale === defaultLocale
      ? defaultMessages
      : (await import(`../../messages/${locale}.json`)).default;

  return {
    locale,
    messages: mergeMessages(defaultMessages, localeMessages),
  };
});
