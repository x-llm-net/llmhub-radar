export function getPublicStatusHref(slug: string, locale = "en") {
  const publicLocale = locale.toLowerCase().startsWith("zh") ? "zh" : "en";
  const origin = getPublicStatusOrigin();

  return `${origin}/${slug}/${publicLocale}`;
}

function getPublicStatusOrigin() {
  const configured =
    process.env.NEXT_PUBLIC_STATUS_PAGE_URL?.trim() ||
    process.env.STATUS_PAGE_PUBLIC_URL?.trim();

  if (configured) return configured.replace(/\/$/, "");

  return process.env.NODE_ENV === "development"
    ? "http://localhost:3001"
    : "https://llm-hub.store";
}
