import type { Metadata } from "next";

export const TITLE = "LLMHub Radar";
export const DESCRIPTION =
  "Monitor LLM provider APIs and publish trustworthy status pages.";

const OG_TITLE = "LLMHub Radar";
const OG_DESCRIPTION =
  "Monitor LLM provider APIs and publish trustworthy status pages.";
const FOOTER = "llm-hub.store";
const IMAGE = "assets/og/dashboard-v2.png";

export const defaultMetadata: Metadata = {
  title: {
    template: `%s | ${TITLE}`,
    default: TITLE,
  },
  description: DESCRIPTION,
  metadataBase: new URL("https://llm-hub.store"),
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
