export function getMarketplaceApiOrigin() {
  const configured = process.env.NEXT_PUBLIC_MARKETPLACE_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  return process.env.NODE_ENV === "development"
    ? "http://127.0.0.1:3010"
    : "https://llm-hub.store";
}

export function getMarketplaceLeaderboardHref(modelSlug?: string) {
  const configured = process.env.NEXT_PUBLIC_MARKETPLACE_URL?.trim();
  const origin = configured
    ? configured.replace(/\/$/, "")
    : process.env.NODE_ENV === "development"
      ? "http://127.0.0.1:18792"
      : "https://llm-hub.store";

  return modelSlug
    ? `${origin}/#leaderboard-${encodeURIComponent(modelSlug)}`
    : `${origin}/#rankings`;
}
