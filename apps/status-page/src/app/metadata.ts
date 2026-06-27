import type { Metadata } from "next";

export const TITLE = "LLMHub Radar";
export const DESCRIPTION =
  "Public LLM provider status pages powered by real API probes.";

const OG_TITLE = "LLMHub Radar";
const OG_DESCRIPTION =
  "Track LLM API provider availability, first-token latency, incidents, and subscriber updates.";
const FOOTER = "llm-hub.store";
const IMAGE = "assets/og/dashboard-v2.png";
const METADATA_BASE =
  process.env.NEXT_PUBLIC_STATUS_PAGE_URL ||
  (process.env.NODE_ENV === "development"
    ? "http://localhost:3001"
    : "https://llm-hub.store");

export const defaultMetadata: Metadata = {
  title: {
    template: `%s | ${TITLE}`,
    default: TITLE,
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-icon.png",
  },
  description: DESCRIPTION,
  metadataBase: new URL(METADATA_BASE),
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
