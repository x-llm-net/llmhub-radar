import { notFound } from "next/navigation";

import {
  Client,
  type HubModelPricePreviewData,
} from "@/app/(dashboard)/radar/models/client";

const previewData = [
  {
    id: "40000000-0000-4000-8000-000000000001",
    slug: "claude-sonnet-4-6",
    vendor: "Anthropic",
    family: "Claude",
    canonicalName: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    shortName: "Sonnet 4.6",
    status: "active",
    sortOrder: 100,
    price: {
      versionId: "50000000-0000-4000-8000-000000000001",
      currency: "USD",
      billingMode: "token",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      source: "official",
      sourceVersion: "2026-08",
      changedByUserId: "admin-1",
      changeReason: "同步官方价格",
      components: [
        {
          component: "input_text",
          unit: "million_tokens",
          unitSize: 1_000_000,
          amountMicros: "3000000",
        },
        {
          component: "output_text",
          unit: "million_tokens",
          unitSize: 1_000_000,
          amountMicros: "15000000",
        },
        {
          component: "cache_read",
          unit: "million_tokens",
          unitSize: 1_000_000,
          amountMicros: "300000",
        },
      ],
    },
  },
  {
    id: "40000000-0000-4000-8000-000000000002",
    slug: "gpt-5-6-sol",
    vendor: "OpenAI",
    family: "GPT",
    canonicalName: "gpt-5.6-sol",
    displayName: "GPT-5.6 SOL",
    shortName: "GPT-5.6 SOL",
    status: "active",
    sortOrder: 90,
    price: {
      versionId: "50000000-0000-4000-8000-000000000002",
      currency: "USD",
      billingMode: "token",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      source: "official",
      sourceVersion: null,
      changedByUserId: "admin-1",
      changeReason: "同步官方价格",
      components: [
        {
          component: "input_text",
          unit: "million_tokens",
          unitSize: 1_000_000,
          amountMicros: "1750000",
        },
        {
          component: "output_text",
          unit: "million_tokens",
          unitSize: 1_000_000,
          amountMicros: "14000000",
        },
      ],
    },
  },
  {
    id: "40000000-0000-4000-8000-000000000003",
    slug: "gemini-3-6-flash",
    vendor: "Google",
    family: "Gemini",
    canonicalName: "gemini-3.6-flash",
    displayName: "Gemini 3.6 Flash",
    shortName: "Gemini 3.6 Flash",
    status: "active",
    sortOrder: 80,
    price: null,
  },
] satisfies HubModelPricePreviewData;

export default function ModelsPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <Client previewData={previewData} />;
}
