function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function stripScheme(value: string) {
  return value.replace(/^https?:\/\//, "");
}

export function getPublicStatusPageUrl(input: {
  customDomain?: string | null;
  slug: string;
}) {
  const customDomain = input.customDomain?.trim();
  if (customDomain) {
    return `https://${stripScheme(stripTrailingSlash(customDomain))}`;
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_STATUS_PAGE_URL?.trim() ||
    process.env.STATUS_PAGE_URL?.trim() ||
    (process.env.NODE_ENV === "development"
      ? "http://localhost:3001"
      : "https://llm-hub.store");

  return `${stripTrailingSlash(baseUrl)}/${input.slug}`;
}
