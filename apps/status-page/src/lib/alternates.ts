import type { Metadata } from "next";

function host({
  slug,
  customDomain,
}: {
  slug: string;
  customDomain?: string | null;
}) {
  if (customDomain) return `https://${customDomain}`;

  const publicOrigin =
    process.env.NEXT_PUBLIC_STATUS_PAGE_URL ||
    (process.env.NODE_ENV === "development"
      ? "http://localhost:3001"
      : "https://llm-hub.store");

  return `${publicOrigin.replace(/\/+$/, "")}/${slug}`;
}

// Next.js merges `alternates` shallowly, so a deeper segment that sets it
// replaces the parent's entirely — always return the full object.
export function statusPageAlternates({
  slug,
  customDomain,
  markdownPath = "/.md",
}: {
  slug: string;
  customDomain?: string | null;
  markdownPath?: string;
}): Metadata["alternates"] {
  const base = host({ slug, customDomain });
  return {
    canonical: base,
    types: {
      "text/markdown": `${base}${markdownPath}`,
      "application/json": `${base}/api/status/summary.json`,
    },
  };
}
