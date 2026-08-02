"use client";

import type { RouterOutputs } from "@openstatus/api";
import { Badge } from "@openstatus/ui/components/ui/badge";
import { Button } from "@openstatus/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openstatus/ui/components/ui/dialog";
import { Label } from "@openstatus/ui/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openstatus/ui/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@openstatus/ui/components/ui/tabs";
import { Textarea } from "@openstatus/ui/components/ui/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  LoaderCircle,
  ShieldX,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionHeaderRow,
  SectionTitle,
} from "@/components/content/section";
import { useTRPC } from "@/lib/trpc/client";

type ListingStatus = "pending" | "listed" | "private" | "delisted";
type ListingReview = RouterOutputs["hub"]["listingReviews"][number];
type Decision = "approve" | "reject";
export type HubListingReviewPreviewData = ListingReview[];

const statusLabels: Record<ListingStatus, string> = {
  pending: "待审核",
  listed: "已上架",
  private: "未上架",
  delisted: "已下架",
};

const statusClasses: Record<ListingStatus, string> = {
  pending:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  listed:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  private:
    "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
  delisted:
    "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
};

const balanceLabels: Record<ListingReview["balanceStatus"], string> = {
  unknown: "未检测",
  available: "余额正常",
  low: "余额偏低",
  exhausted: "余额不足",
  error: "检测异常",
};

const balanceClasses: Record<ListingReview["balanceStatus"], string> = {
  unknown: "text-muted-foreground",
  available: "text-emerald-600 dark:text-emerald-400",
  low: "text-amber-600 dark:text-amber-400",
  exhausted: "text-destructive",
  error: "text-destructive",
};

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function modelSummary(review: ListingReview) {
  const samples = review.models.reduce(
    (total, model) => total + model.sampleCount,
    0,
  );
  const abnormal = review.models.filter(
    (model) =>
      model.currentStatus !== "normal" && model.currentStatus !== "unknown",
  ).length;
  const missingPrices = review.models.filter(
    (model) => !model.priceReady,
  ).length;
  return { samples, abnormal, missingPrices };
}

export function Client({
  previewData,
}: {
  previewData?: HubListingReviewPreviewData;
} = {}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ListingStatus>("pending");
  const [selected, setSelected] = useState<ListingReview | null>(null);
  const [note, setNote] = useState("");

  const accessQuery = useQuery({
    ...trpc.hub.access.queryOptions(),
    ...(previewData
      ? { enabled: false, initialData: { isPlatformAdmin: true } }
      : {}),
  });
  const reviewsQuery = useQuery({
    ...trpc.hub.listingReviews.queryOptions({ status }),
    enabled: previewData ? false : accessQuery.data?.isPlatformAdmin === true,
    initialData: previewData,
  });
  const reviewMutation = useMutation(
    trpc.hub.reviewGroupListing.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.hub.listingReviews.queryKey(),
        });
        toast.success("审核结果已保存");
        setSelected(null);
        setNote("");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const openReview = (review: ListingReview) => {
    setSelected(review);
    setNote(review.listingReviewNote ?? "");
  };

  const submitReview = (decision: Decision) => {
    if (!selected) return;
    if (decision === "reject" && !note.trim()) {
      toast.error("驳回时需要填写说明");
      return;
    }
    reviewMutation.mutate({
      groupId: selected.id,
      decision,
      note: note.trim() || undefined,
    });
  };

  if (accessQuery.isLoading) {
    return (
      <div className="text-muted-foreground flex min-h-56 items-center justify-center text-sm">
        <LoaderCircle className="mr-2 size-4 animate-spin" />
        正在检查访问权限
      </div>
    );
  }

  if (accessQuery.isError) {
    return (
      <SectionGroup>
        <SectionHeader>
          <SectionTitle>无法检查访问权限</SectionTitle>
          <SectionDescription>{accessQuery.error.message}</SectionDescription>
        </SectionHeader>
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={() => accessQuery.refetch()}
        >
          重试
        </Button>
      </SectionGroup>
    );
  }

  if (!accessQuery.data?.isPlatformAdmin) {
    return (
      <SectionGroup>
        <SectionHeader>
          <ShieldX className="text-muted-foreground mb-2 size-5" />
          <SectionTitle>无权访问分组上架审核</SectionTitle>
          <SectionDescription>
            该页面仅供平台管理员处理分组上架申请。
          </SectionDescription>
        </SectionHeader>
        <Button asChild variant="outline" className="w-fit">
          <Link href="/radar">
            <ArrowLeft />
            返回分组管理
          </Link>
        </Button>
      </SectionGroup>
    );
  }

  const reviews = reviewsQuery.data ?? [];

  return (
    <SectionGroup className="max-w-7xl space-y-6 px-4 py-6 lg:px-6 lg:py-8">
      <SectionHeaderRow>
        <SectionHeader>
          <SectionTitle>分组上架审核</SectionTitle>
          <SectionDescription>
            核对分组的可用模型、探测样本和余额状态后决定是否上架。
          </SectionDescription>
        </SectionHeader>
        <Button asChild variant="outline" size="sm">
          <Link href="/radar">
            <ArrowLeft />
            返回分组管理
          </Link>
        </Button>
      </SectionHeaderRow>

      <Section>
        <Tabs
          value={status}
          onValueChange={(value) => setStatus(value as ListingStatus)}
        >
          <TabsList>
            <TabsTrigger value="pending">待审核</TabsTrigger>
            <TabsTrigger value="listed">已上架</TabsTrigger>
            <TabsTrigger value="private">未上架</TabsTrigger>
            <TabsTrigger value="delisted">已下架</TabsTrigger>
          </TabsList>
        </Tabs>

        {reviewsQuery.isLoading ? (
          <div className="text-muted-foreground flex min-h-52 items-center justify-center text-sm">
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            正在加载审核列表
          </div>
        ) : reviewsQuery.isError ? (
          <div className="mt-4 flex min-h-52 flex-col items-center justify-center rounded-md border border-dashed px-4 text-center">
            <p className="text-sm font-medium">审核列表加载失败</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {reviewsQuery.error.message}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => reviewsQuery.refetch()}
            >
              重试
            </Button>
          </div>
        ) : reviews.length ? (
          <div className="mt-4 overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>服务商 / 分组</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>模型 / 样本</TableHead>
                  <TableHead>余额状态</TableHead>
                  <TableHead>申请 / 审核时间</TableHead>
                  <TableHead className="w-16 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviews.map((review) => {
                  const summary = modelSummary(review);
                  return (
                    <TableRow key={review.id}>
                      <TableCell>
                        <div className="min-w-44">
                          <p className="font-medium">{review.providerName}</p>
                          <p className="text-muted-foreground mt-0.5 text-xs">
                            {review.name}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={statusClasses[review.listingStatus]}
                        >
                          {statusLabels[review.listingStatus]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm tabular-nums">
                          {review.models.length} 个模型 · {summary.samples}{" "}
                          个样本
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          {summary.missingPrices > 0
                            ? `${summary.missingPrices} 个模型缺少价格`
                            : summary.abnormal > 0
                              ? `${summary.abnormal} 个模型状态异常`
                              : "当前无异常模型"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`text-sm font-medium ${balanceClasses[review.balanceStatus]}`}
                        >
                          {balanceLabels[review.balanceStatus]}
                        </span>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm tabular-nums">
                          {formatDate(review.listingSubmittedAt)}
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                          {review.listingReviewedAt
                            ? `审核于 ${formatDate(review.listingReviewedAt)}`
                            : "尚未审核"}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title={
                            review.listingStatus === "pending" ? "审核" : "查看"
                          }
                          onClick={() => openReview(review)}
                        >
                          <Eye />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="text-muted-foreground mt-4 flex min-h-52 items-center justify-center rounded-md border border-dashed px-4 text-center text-sm">
            当前没有{statusLabels[status]}的分组
          </div>
        )}

        {!reviewsQuery.isLoading && !reviewsQuery.isError && (
          <p className="text-muted-foreground mt-3 text-xs">
            共 {reviews.length} 个分组
          </p>
        )}
      </Section>

      <Dialog
        open={selected != null}
        onOpenChange={(open) => {
          if (!open && !reviewMutation.isPending) {
            setSelected(null);
            setNote("");
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selected?.listingStatus === "pending"
                ? "审核上架申请"
                : "分组审核记录"}
            </DialogTitle>
            <DialogDescription>
              {selected ? `${selected.providerName} · ${selected.name}` : ""}
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-6">
              <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground text-xs">上架状态</dt>
                  <dd className="mt-1 font-medium">
                    {statusLabels[selected.listingStatus]}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">运行状态</dt>
                  <dd className="mt-1 font-medium">
                    {selected.lifecycleStatus} / {selected.desiredStatus}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">模型与样本</dt>
                  <dd className="mt-1 font-medium tabular-nums">
                    {selected.models.length} 个模型 ·{" "}
                    {modelSummary(selected).samples} 个样本
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">余额状态</dt>
                  <dd
                    className={`mt-1 font-medium ${balanceClasses[selected.balanceStatus]}`}
                  >
                    {balanceLabels[selected.balanceStatus]}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground text-xs">分组说明</dt>
                  <dd className="mt-1 whitespace-pre-wrap">
                    {selected.description || "未填写"}
                  </dd>
                </div>
              </dl>

              {selected.models.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">活跃模型</p>
                  <div className="flex flex-wrap gap-2">
                    {selected.models.map((model, index) => (
                      <Badge
                        key={`${model.displayName ?? "model"}-${index}`}
                        variant={model.priceReady ? "secondary" : "outline"}
                        className={
                          model.priceReady ? undefined : "text-destructive"
                        }
                      >
                        {model.displayName ?? "未映射模型"} ·{" "}
                        {model.priceReady
                          ? `${model.sampleCount} 个样本`
                          : "缺价格"}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="hub-listing-review-note">
                  审核说明
                  {selected.listingStatus === "pending" && (
                    <span className="text-muted-foreground ml-1 text-xs font-normal">
                      驳回时必填
                    </span>
                  )}
                </Label>
                <Textarea
                  id="hub-listing-review-note"
                  className="min-h-24 resize-y"
                  value={note}
                  maxLength={500}
                  placeholder="填写审核依据或需要服务商调整的内容"
                  disabled={
                    selected.listingStatus !== "pending" ||
                    reviewMutation.isPending
                  }
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            {selected?.listingStatus === "pending" ? (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={!note.trim() || reviewMutation.isPending}
                  onClick={() => submitReview("reject")}
                >
                  {reviewMutation.isPending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <XCircle />
                  )}
                  驳回
                </Button>
                <Button
                  type="button"
                  disabled={
                    reviewMutation.isPending ||
                    selected.models.some((model) => !model.priceReady)
                  }
                  onClick={() => submitReview("approve")}
                >
                  {reviewMutation.isPending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <CheckCircle2 />
                  )}
                  通过
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => setSelected(null)}
              >
                关闭
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionGroup>
  );
}
