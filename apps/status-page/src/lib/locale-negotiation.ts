import {
  type Locale,
  defaultLocale as appDefaultLocale,
  locales as appLocales,
} from "@/i18n/config";

type PickPreferredLocaleInput = {
  acceptLanguage?: string | null;
  enabledLocales?: readonly string[] | null;
  fallbackLocale?: string | null;
};

function isLocale(value: string | null | undefined): value is Locale {
  return (
    typeof value === "string" &&
    (appLocales as readonly string[]).includes(value)
  );
}

function enabledLocaleSet(enabledLocales?: readonly string[] | null) {
  const normalized = enabledLocales?.filter(isLocale) ?? [];
  return new Set<Locale>(normalized.length > 0 ? normalized : appLocales);
}

function toSupportedLocale(
  value: string | null | undefined,
  supported: Set<Locale>,
): Locale | null {
  if (!value) return null;

  const normalized = value.toLowerCase();
  const exact = normalized.split(";")[0]?.trim();
  if (isLocale(exact) && supported.has(exact)) return exact;

  const primary = exact?.split("-")[0];
  if (isLocale(primary) && supported.has(primary)) return primary;

  return null;
}

function parseAcceptLanguage(value: string) {
  return value
    .split(",")
    .map((part, index) => {
      const [language = "", ...parameters] = part.trim().split(";");
      const qualityParameter = parameters.find((parameter) =>
        parameter.trim().startsWith("q="),
      );
      const quality = qualityParameter
        ? Number(qualityParameter.trim().slice(2))
        : 1;

      return {
        language,
        index,
        quality: Number.isFinite(quality) ? quality : 0,
      };
    })
    .filter((item) => item.language && item.language !== "*")
    .sort(
      (left, right) => right.quality - left.quality || left.index - right.index,
    );
}

export function pickPreferredLocale({
  acceptLanguage,
  enabledLocales,
  fallbackLocale,
}: PickPreferredLocaleInput): Locale {
  const supported = enabledLocaleSet(enabledLocales);
  const fallback =
    toSupportedLocale(fallbackLocale, supported) ??
    (supported.has(appDefaultLocale)
      ? appDefaultLocale
      : (Array.from(supported)[0] ?? appDefaultLocale));

  if (!acceptLanguage) return fallback;

  for (const { language } of parseAcceptLanguage(acceptLanguage)) {
    const matched = toSupportedLocale(language, supported);
    if (matched) return matched;
  }

  return fallback;
}
