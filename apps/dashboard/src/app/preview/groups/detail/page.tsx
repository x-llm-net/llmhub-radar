import { Badge } from "@openstatus/ui/components/ui/badge";
import { CircleUserRound, Waypoints } from "lucide-react";
import { notFound } from "next/navigation";

import {
  Client,
  type HubGroupDetailPreviewData,
} from "@/app/(dashboard)/radar/groups/[groupId]/client";
import { Wordmark } from "@/components/layout/wordmark";

const previewData = {
  group: {
    id: "10000000-0000-4000-8000-000000000001",
    providerId: "20000000-0000-4000-8000-000000000001",
    providerName: "示例服务商",
    name: "Pro 高可用组",
    description: "面向生产流量的高可用分组，按平台模型目录价应用统一倍率。",
    baseUrl: "https://api.example-provider.com/v1",
    apiKeyLastFour: "7K2M",
    lifecycleStatus: "ready",
    desiredStatus: "active",
    listingStatus: "listed",
    listingSubmittedAt: null,
    listingReviewedAt: null,
    listingReviewedBy: null,
    listingReviewNote: null,
    configVersion: 4,
    multiplierBps: 8200,
    balanceMicros: "18650000",
    balanceCurrency: "CNY",
    balanceStatus: "available",
    balanceCheckedAt: "2026-08-02T02:08:00.000Z",
    models: [
      {
        id: "30000000-0000-4000-8000-000000000001",
        modelId: "40000000-0000-4000-8000-000000000001",
        upstreamName: "claude-sonnet-4-6",
        discoveryStatus: "active",
        trafficEnabled: true,
        probeEnabled: true,
        baseUrlOverride: null,
        canonicalName: "claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6",
        availabilityBps: 9987,
        firstTokenP50Ms: 820,
        firstTokenP95Ms: 1640,
        sampleCount: 986,
        currentStatus: "normal",
        lastCheckAt: "2026-08-02T02:10:00.000Z",
      },
      {
        id: "30000000-0000-4000-8000-000000000002",
        modelId: "40000000-0000-4000-8000-000000000002",
        upstreamName: "gpt-5.6-sol",
        discoveryStatus: "active",
        trafficEnabled: true,
        probeEnabled: true,
        baseUrlOverride: "https://sol.example-provider.com/v1",
        canonicalName: "gpt-5.6-sol",
        displayName: "GPT-5.6 SOL",
        availabilityBps: 9824,
        firstTokenP50Ms: 1120,
        firstTokenP95Ms: 2940,
        sampleCount: 941,
        currentStatus: "degraded",
        lastCheckAt: "2026-08-02T02:10:00.000Z",
      },
      {
        id: "30000000-0000-4000-8000-000000000003",
        modelId: "40000000-0000-4000-8000-000000000003",
        upstreamName: "gemini-3.6-flash-preview",
        discoveryStatus: "missing",
        trafficEnabled: false,
        probeEnabled: true,
        baseUrlOverride: null,
        canonicalName: "gemini-3.6-flash-preview",
        displayName: "Gemini 3.6 Flash Preview",
        availabilityBps: null,
        firstTokenP50Ms: null,
        firstTokenP95Ms: null,
        sampleCount: 0,
        currentStatus: "unknown",
        lastCheckAt: null,
      },
    ],
    createdAt: "2026-07-21T08:30:00.000Z",
    updatedAt: "2026-08-02T02:09:00.000Z",
  },
  runs: [
    {
      cycleId: "50000000-0000-4000-8000-000000000001",
      groupModelId: "30000000-0000-4000-8000-000000000001",
      modelName: "Claude Sonnet 4.6",
      upstreamModelName: "claude-sonnet-4-6",
      outcome: "success",
      httpStatus: 200,
      errorCode: null,
      safeErrorSummary: null,
      firstTokenMs: 790,
      totalLatencyMs: 2180,
      scheduledAt: "2026-08-02T02:10:00.000Z",
      completedAt: "2026-08-02T02:10:03.000Z",
    },
    {
      cycleId: "50000000-0000-4000-8000-000000000002",
      groupModelId: "30000000-0000-4000-8000-000000000002",
      modelName: "GPT-5.6 SOL",
      upstreamModelName: "gpt-5.6-sol",
      outcome: "provider_failure",
      httpStatus: 503,
      errorCode: "upstream_unavailable",
      safeErrorSummary: "上游暂时不可用，已记录为本轮失败",
      firstTokenMs: null,
      totalLatencyMs: 3012,
      scheduledAt: "2026-08-02T02:10:00.000Z",
      completedAt: "2026-08-02T02:10:04.000Z",
    },
    {
      cycleId: "50000000-0000-4000-8000-000000000003",
      groupModelId: "30000000-0000-4000-8000-000000000002",
      modelName: "GPT-5.6 SOL",
      upstreamModelName: "gpt-5.6-sol",
      outcome: "success",
      httpStatus: 200,
      errorCode: null,
      safeErrorSummary: null,
      firstTokenMs: 1080,
      totalLatencyMs: 2760,
      scheduledAt: "2026-08-02T01:50:00.000Z",
      completedAt: "2026-08-02T01:50:03.000Z",
    },
  ],
  catalog: [
    {
      id: "40000000-0000-4000-8000-000000000001",
      canonicalName: "claude-sonnet-4-6",
      displayName: "Claude Sonnet 4.6",
      vendor: "Anthropic",
      family: "Claude",
      status: "active",
    },
    {
      id: "40000000-0000-4000-8000-000000000002",
      canonicalName: "gpt-5.6-sol",
      displayName: "GPT-5.6 SOL",
      vendor: "OpenAI",
      family: "GPT",
      status: "active",
    },
    {
      id: "40000000-0000-4000-8000-000000000003",
      canonicalName: "gemini-3.6-flash-preview",
      displayName: "Gemini 3.6 Flash Preview",
      vendor: "Google",
      family: "Gemini",
      status: "active",
    },
  ],
} satisfies HubGroupDetailPreviewData;

export default function GroupDetailPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <div className="bg-background min-h-screen lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="bg-sidebar hidden min-h-screen border-r lg:flex lg:flex-col">
        <div className="flex h-14 items-center border-b px-4">
          <Wordmark showText size={32} href="/preview/groups" />
        </div>
        <div className="flex-1 px-3 py-5">
          <div className="bg-accent text-accent-foreground flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium">
            <Waypoints className="size-4" />
            分组管理
          </div>
        </div>
        <div className="border-t p-3">
          <div className="flex items-center gap-3 rounded-md px-2 py-2">
            <div className="bg-secondary flex size-8 items-center justify-center rounded-md">
              <CircleUserRound className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">X-LLM</p>
              <p className="text-muted-foreground truncate text-xs">
                渠道商工作区
              </p>
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="bg-background sticky top-0 z-20 flex h-14 items-center justify-between border-b px-4 lg:px-6">
          <div className="flex items-center gap-2 text-sm">
            <Waypoints className="text-muted-foreground size-4" />
            <span className="font-medium">分组详情</span>
          </div>
          <Badge variant="outline" className="text-muted-foreground">
            新版预览
          </Badge>
        </header>
        <main>
          <Client previewData={previewData} />
        </main>
      </div>
    </div>
  );
}
