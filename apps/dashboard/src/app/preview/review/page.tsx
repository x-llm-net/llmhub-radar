import { notFound } from "next/navigation";

import {
  Client,
  type HubListingReviewPreviewData,
} from "@/app/(dashboard)/radar/review/client";

const previewData = [
  {
    id: "10000000-0000-4000-8000-000000000011",
    providerName: "X-LLM",
    ownerWorkspaceId: "workspace-xllm",
    name: "Pro 高可用组",
    description: "生产流量分组，覆盖常用文本模型。",
    lifecycleStatus: "ready",
    desiredStatus: "active",
    listingStatus: "pending",
    listingSubmittedAt: "2026-08-02T01:30:00.000Z",
    listingReviewedAt: null,
    listingReviewedBy: null,
    listingReviewNote: null,
    balanceStatus: "available",
    createdAt: "2026-07-26T04:00:00.000Z",
    models: [
      {
        displayName: "Claude Sonnet 4.6",
        priceReady: true,
        currentStatus: "normal",
        sampleCount: 986,
      },
      {
        displayName: "GPT-5.6 SOL",
        priceReady: true,
        currentStatus: "degraded",
        sampleCount: 941,
      },
      {
        displayName: "Gemini 3.6 Flash",
        priceReady: true,
        currentStatus: "normal",
        sampleCount: 915,
      },
    ],
  },
  {
    id: "10000000-0000-4000-8000-000000000012",
    providerName: "示例云",
    ownerWorkspaceId: "workspace-example",
    name: "Plus 混合组",
    description: "低倍率混合分组，适合日常开发调用。",
    lifecycleStatus: "ready",
    desiredStatus: "active",
    listingStatus: "pending",
    listingSubmittedAt: "2026-08-01T13:45:00.000Z",
    listingReviewedAt: null,
    listingReviewedBy: null,
    listingReviewNote: null,
    balanceStatus: "low",
    createdAt: "2026-07-29T09:00:00.000Z",
    models: [
      {
        displayName: "GPT-5.5",
        priceReady: true,
        currentStatus: "normal",
        sampleCount: 472,
      },
      {
        displayName: "Claude Haiku 4.5",
        priceReady: false,
        currentStatus: "normal",
        sampleCount: 468,
      },
    ],
  },
] satisfies HubListingReviewPreviewData;

export default function ReviewPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <Client previewData={previewData} />;
}
