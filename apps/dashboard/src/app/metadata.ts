import type { Metadata } from "next";

export const TITLE = "LLMHub Radar";
export const DESCRIPTION =
  "Monitor LLM provider APIs and publish trustworthy status pages.";

const OG_TITLE = "LLMHub Radar";
const OG_DESCRIPTION =
  "Monitor LLM provider APIs and publish trustworthy status pages.";
const FOOTER = "llm-hub.store";
const IMAGE = "assets/og/dashboard-v2.png";
const METADATA_BASE =
  process.env.NEXT_PUBLIC_DASHBOARD_URL ||
  process.env.NEXT_PUBLIC_URL ||
  (process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : "https://app.llm-hub.store");

export const defaultMetadata: Metadata = {
  title: {
    template: `%s | ${TITLE}`,
    default: TITLE,
  },
  description: DESCRIPTION,
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-icon.png",
  },
  metadataBase: new URL(METADATA_BASE),
  robots: {
    index: false,
    follow: false,
  },
};

export const twitterMetadata: Metadata["twitter"] = {
  title: TITLE,
  description: DESCRIPTION,
  card: "summary_large_image",
  images: [
    `/api/og?title=${OG_TITLE}&description=${OG_DESCRIPTION}&footer=${FOOTER}&image=${IMAGE}`,
  ],
};

export const ogMetadata: Metadata["openGraph"] = {
  title: TITLE,
  description: DESCRIPTION,
  type: "website",
  images: [
    `/api/og?title=${OG_TITLE}&description=${OG_DESCRIPTION}&footer=${FOOTER}&image=${IMAGE}`,
  ],
};
