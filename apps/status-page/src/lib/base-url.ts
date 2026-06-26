export function getBaseUrl({
  slug,
  customDomain,
}: {
  slug?: string;
  customDomain?: string;
}) {
  if (process.env.NODE_ENV === "development") {
    return `http://localhost:3001/${slug}`;
  }
  if (customDomain) {
    return `https://${customDomain}`;
  }
  const baseUrl =
    process.env.NEXT_PUBLIC_STATUS_PAGE_URL ?? "https://llm-hub.store";
  return `${baseUrl.replace(/\/+$/, "")}/${slug}`;
}
