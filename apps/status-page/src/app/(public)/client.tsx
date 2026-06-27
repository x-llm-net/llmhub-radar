"use client";

import type { RouterOutputs } from "@openstatus/api";
import { Badge } from "@openstatus/ui/components/ui/badge";
import { Button } from "@openstatus/ui/components/ui/button";
import { cn } from "@openstatus/ui/lib/utils";
import {
  Activity,
  ArrowRight,
  Bell,
  CheckCircle2,
  Clock3,
  RadioTower,
  ShieldCheck,
} from "lucide-react";
import Image from "next/image";

import { Link } from "@/components/common/link";

type Directory = RouterOutputs["statusPage"]["listPublicRadar"];
type DirectoryItem = Directory["items"][number];

const dashboardUrl =
  process.env.NEXT_PUBLIC_DASHBOARD_URL ||
  process.env.NEXT_PUBLIC_URL ||
  (process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : "https://app.llm-hub.store");

const statusCopy = {
  success: {
    label: "正常",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  degraded: {
    label: "部分异常",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  error: {
    label: "服务中断",
    className: "border-red-200 bg-red-50 text-red-700",
  },
  info: {
    label: "暂无数据",
    className: "border-slate-200 bg-slate-50 text-slate-600",
  },
} as const;

const highlights = [
  {
    icon: RadioTower,
    title: "真实 API 探测",
    description: "定时请求服务商 API，记录可用性、首 token 时间和错误状态。",
  },
  {
    icon: Activity,
    title: "公开服务状态",
    description: "把多个 API 密钥汇总到一个服务商状态页，方便下游快速判断。",
  },
  {
    icon: Bell,
    title: "订阅通知",
    description: "支持邮箱和 Webhook，服务波动时主动通知关注者。",
  },
] as const;

function formatAvailability(value: number | null) {
  if (value === null) return "暂无样本";
  if (value === 10_000) return "100%";
  return `${(value / 100).toFixed(2)}%`;
}

function formatLatency(value: number | null) {
  if (value === null) return "暂无样本";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

function formatRelativeTime(value: Date | null) {
  if (!value) return "尚未检测";
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - value.getTime()) / 1000),
  );
  if (seconds < 60) return "刚刚检测";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function statusPath(item: DirectoryItem) {
  return `/${item.page.slug}/${item.page.defaultLocale || "zh"}`;
}

function dayTone(day: DirectoryItem["dailyStatus7d"][number]) {
  const total = day.ok + day.degraded + day.error;
  if (total === 0) return "bg-muted";
  if (day.error > 0 && day.error >= day.ok + day.degraded) return "bg-red-500";
  if (day.degraded > 0 || day.error > 0) return "bg-amber-500";
  return "bg-emerald-500";
}

function DirectoryCard({ item }: { item: DirectoryItem }) {
  const status = statusCopy[item.status];
  return (
    <Link href={statusPath(item)} variant="unstyled" className="group block">
      <article className="border-border bg-card hover:border-foreground/20 h-full overflow-hidden rounded-lg border shadow-sm transition-colors">
        <div className="border-border flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {item.page.icon ? (
                <img
                  src={item.page.icon}
                  alt=""
                  className="size-6 rounded-md"
                />
              ) : (
                <div className="bg-muted flex size-6 items-center justify-center rounded-md border">
                  <RadioTower className="text-muted-foreground size-3.5" />
                </div>
              )}
              <h2 className="truncate text-sm font-semibold">
                {item.page.title}
              </h2>
            </div>
            <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-5">
              {item.page.description || item.pool.description || item.pool.name}
            </p>
          </div>
          <Badge className={cn("shrink-0", status.className)}>
            {status.label}
          </Badge>
        </div>

        <div className="space-y-4 p-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              ["7 天可用性", formatAvailability(item.availability7d)],
              ["首 token P50", formatLatency(item.p50FirstTokenMs)],
              ["首 token P95", formatLatency(item.p95FirstTokenMs)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border p-2">
                <div className="text-muted-foreground text-[11px]">{label}</div>
                <div className="mt-1 text-sm font-semibold">{value}</div>
              </div>
            ))}
          </div>

          <div>
            <div className="text-muted-foreground mb-2 flex justify-between text-xs">
              <span>7 天探测概览</span>
              <span>{item.sampleCount7d} 个样本</span>
            </div>
            <div className="grid h-8 grid-cols-7 gap-1">
              {item.dailyStatus7d.map((day) => (
                <div
                  key={day.date}
                  title={`${day.date}：正常 ${day.ok}，降级 ${day.degraded}，失败 ${day.error}`}
                  className={cn("rounded-sm", dayTone(day))}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {item.modelFamilies.length > 0 ? (
              item.modelFamilies.map((family) => (
                <Badge key={family} variant="outline" className="font-mono">
                  {family}
                </Badge>
              ))
            ) : (
              <Badge variant="outline">暂无模型标签</Badge>
            )}
          </div>

          <div className="text-muted-foreground flex items-center justify-between border-t pt-3 text-xs">
            <span>{item.credentialCount} 个 API 密钥</span>
            <span>{formatRelativeTime(item.lastCheckAt)}</span>
          </div>
        </div>
      </article>
    </Link>
  );
}

export function Client({
  directory,
  offset,
}: {
  directory: Directory;
  offset: number;
}) {
  const hasPrevious = offset > 0;
  const nextOffset = offset + directory.limit;
  const hasNext = nextOffset < directory.totalSize;

  return (
    <main className="bg-background min-h-dvh">
      <section className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" variant="unstyled" className="flex items-center gap-3">
            <Image
              src="/llmhub-radar-logo.png"
              alt="LLMHub Radar"
              width={36}
              height={36}
              className="size-9 rounded-md"
              priority
            />
            <div className="leading-tight">
              <div className="text-sm font-semibold">LLMHub Radar</div>
              <div className="text-muted-foreground text-xs">服务商雷达</div>
            </div>
          </Link>
          <Button variant="outline" size="sm" asChild>
            <Link href={dashboardUrl} target="_blank" rel="noreferrer">
              进入控制台
            </Link>
          </Button>
        </header>

        <div className="space-y-8 py-12">
          <div className="max-w-3xl space-y-5">
            <Badge variant="outline" className="gap-1.5">
              <ShieldCheck className="size-3.5" />
              面向 LLM 中转与上游渠道的公开状态页
            </Badge>
            <div className="space-y-4">
              <h1 className="text-4xl leading-tight font-semibold tracking-normal sm:text-5xl">
                用真实请求展示服务商稳定性
              </h1>
              <p className="text-muted-foreground max-w-2xl text-base leading-7 sm:text-lg">
                汇总公开服务商的真实探测结果，展示 API 密钥可用性、首 token
                时间和近期波动，帮你挑选更适合自己的服务商。
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" asChild>
                <Link href={dashboardUrl} target="_blank" rel="noreferrer">
                  创建服务商状态页
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              {directory.items[0] ? (
                <Button size="lg" variant="outline" asChild>
                  <Link href={statusPath(directory.items[0])}>
                    查看最新公开页
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">公开服务商</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                共 {directory.totalSize} 个公开服务商状态页
              </p>
            </div>
            <div className="text-muted-foreground flex items-center gap-4 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-emerald-600" />
                真实探测
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="size-4" />
                定时更新
              </span>
            </div>
          </div>

          {directory.items.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {directory.items.map((item) => (
                <DirectoryCard key={item.page.slug} item={item} />
              ))}
            </div>
          ) : (
            <div className="border-border bg-card rounded-lg border p-8 text-center">
              <div className="text-base font-medium">暂无公开服务商</div>
              <p className="text-muted-foreground mt-2 text-sm">
                创建并发布服务商状态页后，这里会展示真实探测结果。
              </p>
            </div>
          )}

          {(hasPrevious || hasNext) && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" disabled={!hasPrevious} asChild>
                <Link
                  href={
                    hasPrevious
                      ? `/?offset=${Math.max(0, offset - directory.limit)}`
                      : "/"
                  }
                >
                  上一页
                </Link>
              </Button>
              <Button variant="outline" disabled={!hasNext} asChild>
                <Link href={hasNext ? `/?offset=${nextOffset}` : "/"}>
                  下一页
                </Link>
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-3 border-t py-6 sm:grid-cols-3">
          {highlights.map((item) => (
            <div key={item.title} className="flex gap-3">
              <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md border">
                <item.icon className="text-muted-foreground size-4" />
              </div>
              <div>
                <div className="text-sm font-medium">{item.title}</div>
                <p className="text-muted-foreground mt-1 text-sm leading-6">
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
