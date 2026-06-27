function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function stripScheme(value: string) {
  return value.replace(/^https?:\/\//, "");
}

function appendLocale(value: string, locale?: string | null) {
  const base = stripTrailingSlash(value);
  const normalized = locale?.trim().toLowerCase();
  if (!normalized) return base;
  return `${base}/${encodeURIComponent(normalized)}`;
}

export function getPublicStatusPageUrl(input: {
  customDomain?: string | null;
  slug: string;
  locale?: string | null;
}) {
  const customDomain = input.customDomain?.trim();
  if (customDomain) {
    return appendLocale(
      `https://${stripScheme(stripTrailingSlash(customDomain))}`,
      input.locale,
    );
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_STATUS_PAGE_URL?.trim() ||
    process.env.STATUS_PAGE_URL?.trim() ||
    (process.env.NODE_ENV === "development"
      ? "http://localhost:3001"
      : "https://llm-hub.store");

  return appendLocale(
    `${stripTrailingSlash(baseUrl)}/${input.slug}`,
    input.locale,
  );
}
