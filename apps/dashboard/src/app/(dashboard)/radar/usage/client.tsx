"use client";

import type { RouterOutputs } from "@openstatus/api";
import { Badge } from "@openstatus/ui/components/ui/badge";
import { Button } from "@openstatus/ui/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openstatus/ui/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, LoaderCircle, RefreshCw } from "lucide-react";
import Link from "next/link";

import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionHeaderRow,
  SectionTitle,
} from "@/components/content/section";
import { useTRPC } from "@/lib/trpc/client";

type Activity = RouterOutputs["hub"]["activity"];
type RequestItem = Activity["requests"][number];

const statusLabels: Record<RequestItem["status"], string> = {
  planned: "排队中",
  running: "处理中",
  succeeded: "成功",
  failed: "失败",
};

const statusClasses: Record<RequestItem["status"], string> = {
  planned:
    "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
  running:
    "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
  succeeded:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  failed:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
};

function formatMicros(value: string) {
  const amount = BigInt(value);
  const zero = BigInt(0);
  const microsPerUsd = BigInt(1_000_000);
  const negative = amount < zero;
  const absolute = negative ? -amount : amount;
  const whole = absolute / microsPerUsd;
  const fraction = (absolute % microsPerUsd)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}$${whole}${fraction ? `.${fraction}` : ""}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatCharge(request: RequestItem) {
  if (request.chargedAmountMicros != null) {
    return formatMicros(request.chargedAmountMicros);
  }
  if (request.billingStatus === "reserved") {
    return request.status === "succeeded" ? "结算中" : "已预留";
  }
  return "未扣费";
}

export function Client() {
  const trpc = useTRPC();
  const activityQuery = useQuery(trpc.hub.activity.queryOptions());
  const activity = activityQuery.data;
  const requests = activity?.requests ?? [];

  return (
    <SectionGroup className="max-w-7xl space-y-6 px-4 py-6 lg:px-6 lg:py-8">
      <SectionHeaderRow>
        <SectionHeader>
          <SectionTitle>用量与账单</SectionTitle>
          <SectionDescription>
            查看最近的 API 请求、路由结果和实际扣费。
          </SectionDescription>
        </SectionHeader>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            title="刷新"
            aria-label="刷新"
            disabled={activityQuery.isFetching}
            onClick={() => activityQuery.refetch()}
          >
            <RefreshCw
              className={activityQuery.isFetching ? "animate-spin" : undefined}
            />
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/radar/tokens">
              <ArrowLeft />
              令牌与订阅
            </Link>
          </Button>
        </div>
      </SectionHeaderRow>

      <Section>
        <div className="grid gap-5 border-y py-5 sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground text-xs">当前余额</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {activity ? formatMicros(activity.balanceMicros) : "-"}
              <span className="text-muted-foreground ml-2 text-xs font-normal">
                {activity?.currency ?? "USD"}
              </span>
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">最近请求</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {activity ? requests.length : "-"}
              <span className="text-muted-foreground ml-2 text-xs font-normal">
                最多显示 50 条
              </span>
            </p>
          </div>
        </div>
      </Section>

      <Section>
        <SectionHeader>
          <SectionTitle>请求记录</SectionTitle>
          <SectionDescription>
            只有上游成功并返回可结算用量后才会产生实际扣费。
          </SectionDescription>
        </SectionHeader>

        {activityQuery.isLoading ? (
          <div className="text-muted-foreground flex min-h-52 items-center justify-center text-sm">
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            正在加载请求记录
          </div>
        ) : activityQuery.isError ? (
          <div className="mt-4 flex min-h-52 flex-col items-center justify-center rounded-md border border-dashed px-4 text-center">
            <p className="text-sm font-medium">请求记录加载失败</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {activityQuery.error.message}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => activityQuery.refetch()}
            >
              重试
            </Button>
          </div>
        ) : requests.length === 0 ? (
          <div className="text-muted-foreground mt-4 flex min-h-52 items-center justify-center rounded-md border border-dashed px-4 text-center text-sm">
            还没有 API 请求记录
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>时间</TableHead>
                  <TableHead>模型</TableHead>
                  <TableHead>令牌</TableHead>
                  <TableHead>最终分组</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">尝试</TableHead>
                  <TableHead className="text-right">Token 用量</TableHead>
                  <TableHead className="text-right">扣费</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((request) => (
                  <TableRow key={request.requestId}>
                    <TableCell className="text-sm whitespace-nowrap tabular-nums">
                      {formatDate(request.createdAt)}
                    </TableCell>
                    <TableCell className="min-w-40 font-medium">
                      {request.modelName}
                    </TableCell>
                    <TableCell>{request.tokenName}</TableCell>
                    <TableCell>
                      {request.providerName && request.groupName ? (
                        <div className="min-w-36">
                          <p className="text-sm">{request.providerName}</p>
                          <p className="text-muted-foreground text-xs">
                            {request.groupName}
                          </p>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={statusClasses[request.status]}
                      >
                        {statusLabels[request.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {request.attemptCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(
                        request.inputTokens + request.outputTokens
                      ).toLocaleString("zh-CN")}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatCharge(request)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </SectionGroup>
  );
}
