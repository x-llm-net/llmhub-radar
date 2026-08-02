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
import { Input } from "@openstatus/ui/components/ui/input";
import { Label } from "@openstatus/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openstatus/ui/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openstatus/ui/components/ui/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  Clock3,
  Gauge,
  Link2,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  ServerCog,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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
import { cn } from "@/lib/utils";

type HubGroup = RouterOutputs["hub"]["group"];
type HubGroupModel = HubGroup["models"][number];
type HubProbeRun = RouterOutputs["hub"]["groupProbeRuns"][number];
type HubCatalogModel = RouterOutputs["hub"]["catalogModels"][number];

export type HubGroupDetailPreviewData = {
  group: HubGroup;
  runs: HubProbeRun[];
  catalog: HubCatalogModel[];
};

const statusLabels = {
  unknown: "等待数据",
  normal: "正常",
  degraded: "波动",
  down: "异常",
  configuration_error: "配置错误",
  stale: "数据过期",
} as const;

const outcomeLabels = {
  success: "成功",
  provider_failure: "上游失败",
  configuration_error: "配置错误",
  observer_error: "探测错误",
} as const;

export function Client({
  previewData,
}: {
  previewData?: HubGroupDetailPreviewData;
} = {}) {
  const params = useParams<{ groupId: string }>();
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const groupId = previewData?.group.id ?? params.groupId;
  const groupOptions = trpc.hub.group.queryOptions({ groupId });
  const runsOptions = trpc.hub.groupProbeRuns.queryOptions({
    groupId,
  });
  const groupQuery = useQuery({
    ...groupOptions,
    enabled: previewData == null,
    initialData: previewData?.group,
  });
  const runsQuery = useQuery({
    ...runsOptions,
    enabled: previewData == null,
    initialData: previewData?.runs,
  });
  const catalogQuery = useQuery({
    ...trpc.hub.catalogModels.queryOptions(),
    enabled: previewData == null,
    initialData: previewData?.catalog,
  });
  const group = groupQuery.data;
  const preview = previewData != null;
  const backHref = preview ? "/preview/groups" : "/radar";
  const [endpointModel, setEndpointModel] = useState<HubGroupModel | null>(
    null,
  );
  const [baseUrlOverride, setBaseUrlOverride] = useState("");

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries(groupOptions),
      queryClient.invalidateQueries(runsOptions),
      queryClient.invalidateQueries(trpc.hub.groups.queryOptions()),
    ]);
  };

  const probeMutation = useMutation(
    trpc.hub.probeGroupNow.mutationOptions({
      onSuccess: async (result) => {
        await refresh();
        toast.success(`已安排 ${result.scheduled} 个模型立即探测`);
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const discoverMutation = useMutation(
    trpc.hub.discoverGroupModels.mutationOptions({
      onSuccess: async () => {
        await refresh();
        toast.success("模型目录已刷新");
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const stateMutation = useMutation(
    trpc.hub.setGroupState.mutationOptions({
      onSuccess: async (_result, input) => {
        await refresh();
        toast.success(
          input.action === "pause"
            ? "分组已暂停"
            : input.action === "resume"
              ? "分组已恢复"
              : "分组已退役",
        );
        if (input.action === "retire") router.push("/radar");
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const mapMutation = useMutation(
    trpc.hub.mapGroupModel.mutationOptions({
      onSuccess: async () => {
        await refresh();
        toast.success("模型映射已更新");
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const requestListingMutation = useMutation(
    trpc.hub.requestGroupListing.mutationOptions({
      onSuccess: async () => {
        await refresh();
        toast.success("上架申请已提交");
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const withdrawListingMutation = useMutation(
    trpc.hub.withdrawGroupListing.mutationOptions({
      onSuccess: async () => {
        await refresh();
        toast.success(
          group?.listingStatus === "listed" ? "分组已下架" : "上架申请已撤回",
        );
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const modelConfigMutation = useMutation(
    trpc.hub.updateGroupModelConfig.mutationOptions({
      onSuccess: async () => {
        setEndpointModel(null);
        await refresh();
        toast.success("专用端点已更新");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (groupQuery.isLoading) {
    return (
      <div className="text-muted-foreground flex min-h-80 items-center justify-center">
        <LoaderCircle className="mr-2 size-4 animate-spin" />
        正在加载分组
      </div>
    );
  }

  if (groupQuery.isError || !group) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center px-4 text-center">
        <Activity className="text-destructive size-5" />
        <p className="mt-3 text-sm font-medium">无法加载分组</p>
        <p className="text-muted-foreground mt-1 text-xs">
          {groupQuery.error?.message ?? "分组不存在或无权访问"}
        </p>
        <Button className="mt-4" size="sm" variant="outline" asChild>
          <Link href={backHref}>
            <ArrowLeft />
            返回分组列表
          </Link>
        </Button>
      </div>
    );
  }

  const activeModels = group.models.filter(
    (model) => model.discoveryStatus === "active",
  );
  const measuredModels = activeModels.filter(
    (model) => model.availabilityBps !== null,
  );
  const averageAvailability =
    measuredModels.length === 0
      ? null
      : Math.round(
          measuredModels.reduce(
            (sum, model) => sum + (model.availabilityBps ?? 0),
            0,
          ) / measuredModels.length,
        );
  const latencyValues = activeModels
    .map((model) => model.firstTokenP50Ms)
    .filter((value): value is number => value !== null);
  const medianLatency = latencyValues.length
    ? Math.round(
        latencyValues.reduce((sum, value) => sum + value, 0) /
          latencyValues.length,
      )
    : null;
  const retired = group.lifecycleStatus === "retired";
  const busy =
    probeMutation.isPending ||
    discoverMutation.isPending ||
    stateMutation.isPending ||
    requestListingMutation.isPending ||
    withdrawListingMutation.isPending;

  const openEndpointDialog = (model: HubGroupModel) => {
    setEndpointModel(model);
    setBaseUrlOverride(model.baseUrlOverride ?? "");
  };

  const saveEndpoint = () => {
    if (!endpointModel) return;
    modelConfigMutation.mutate({
      groupModelId: endpointModel.id,
      baseUrlOverride: baseUrlOverride.trim() || null,
    });
  };

  return (
    <SectionGroup className="max-w-7xl space-y-7 px-4 py-6 lg:px-6 lg:py-8">
      <Section>
        <SectionHeaderRow className="items-start sm:items-start">
          <SectionHeader>
            <div className="flex flex-wrap items-center gap-2">
              <SectionTitle className="text-xl">{group.name}</SectionTitle>
              <GroupStatus group={group} />
            </div>
            <SectionDescription>
              {group.description || `${group.providerName} 的供给分组`}
            </SectionDescription>
          </SectionHeader>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href={backHref}>
                <ArrowLeft />
                返回
              </Link>
            </Button>
            {!retired && (
              <>
                {(group.listingStatus === "private" ||
                  group.listingStatus === "delisted") && (
                  <Button
                    size="sm"
                    disabled={
                      busy || preview || group.lifecycleStatus !== "ready"
                    }
                    title={
                      group.lifecycleStatus === "ready"
                        ? undefined
                        : "完成验证并启用至少一个模型后可申请上架"
                    }
                    onClick={() =>
                      requestListingMutation.mutate({ groupId: group.id })
                    }
                  >
                    {requestListingMutation.isPending && (
                      <LoaderCircle className="animate-spin" />
                    )}
                    {group.listingStatus === "delisted"
                      ? "重新申请上架"
                      : "申请上架"}
                  </Button>
                )}
                {group.listingStatus === "pending" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || preview}
                    onClick={() =>
                      withdrawListingMutation.mutate({ groupId: group.id })
                    }
                  >
                    {withdrawListingMutation.isPending && (
                      <LoaderCircle className="animate-spin" />
                    )}
                    撤回申请
                  </Button>
                )}
                {group.listingStatus === "listed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || preview}
                    onClick={() => {
                      if (window.confirm("确认下架“" + group.name + "”？")) {
                        withdrawListingMutation.mutate({ groupId: group.id });
                      }
                    }}
                  >
                    {withdrawListingMutation.isPending && (
                      <LoaderCircle className="animate-spin" />
                    )}
                    下架
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || preview}
                  onClick={() => discoverMutation.mutate({ groupId: group.id })}
                >
                  <RefreshCw
                    className={cn(discoverMutation.isPending && "animate-spin")}
                  />
                  刷新模型
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || preview || group.desiredStatus === "paused"}
                  onClick={() => probeMutation.mutate({ groupId: group.id })}
                >
                  <RotateCw
                    className={cn(probeMutation.isPending && "animate-spin")}
                  />
                  立即探测
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || preview}
                  onClick={() =>
                    stateMutation.mutate({
                      groupId: group.id,
                      action:
                        group.desiredStatus === "paused" ? "resume" : "pause",
                    })
                  }
                >
                  {group.desiredStatus === "paused" ? <Play /> : <Pause />}
                  {group.desiredStatus === "paused" ? "恢复" : "暂停"}
                </Button>
                <Button
                  size="icon-sm"
                  variant="outline"
                  title="退役分组"
                  disabled={busy || preview}
                  onClick={() => {
                    if (
                      window.confirm(
                        `确认退役“${group.name}”？退役后不能恢复。`,
                      )
                    ) {
                      stateMutation.mutate({
                        groupId: group.id,
                        action: "retire",
                      });
                    }
                  }}
                >
                  <Trash2 className="text-destructive" />
                </Button>
              </>
            )}
          </div>
        </SectionHeaderRow>

        {group.listingReviewNote && group.listingStatus === "private" && (
          <p className="border-destructive/30 bg-destructive/5 text-destructive mt-4 rounded-md border px-3 py-2 text-sm">
            上架申请未通过：{group.listingReviewNote}
          </p>
        )}

        <div className="bg-card mt-5 grid overflow-hidden rounded-md border sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="7 日可用率"
            value={
              averageAvailability === null
                ? "--"
                : `${(averageAvailability / 100).toFixed(2)}%`
            }
            detail={`${measuredModels.length} 个模型有数据`}
            icon={Gauge}
          />
          <Metric
            label="平均首字"
            value={
              medianLatency === null ? "--" : formatDuration(medianLatency)
            }
            detail="各模型 P50 均值"
            icon={Clock3}
          />
          <Metric
            label="模型"
            value={String(activeModels.length)}
            detail={`共发现 ${group.models.length} 个`}
            icon={ServerCog}
          />
          <Metric
            label="分组倍率"
            value={
              group.multiplierBps === null
                ? "--"
                : `${(group.multiplierBps / 10_000).toFixed(2)}x`
            }
            detail={`API Key 尾号 ${group.apiKeyLastFour}`}
            icon={Activity}
          />
        </div>

        <div className="text-muted-foreground mt-4 grid gap-2 text-xs sm:grid-cols-2">
          <p className="truncate font-mono">Base URL: {group.baseUrl}</p>
          <p className="sm:text-right">
            配置版本 {group.configVersion} · 更新于{" "}
            {formatDate(group.updatedAt)}
          </p>
        </div>
      </Section>

      <Section>
        <SectionHeader>
          <SectionTitle>模型健康</SectionTitle>
          <SectionDescription>每个上游模型独立探测和统计。</SectionDescription>
        </SectionHeader>
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>模型</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>7 日可用率</TableHead>
                <TableHead>首字 P50 / P95</TableHead>
                <TableHead>样本</TableHead>
                <TableHead className="w-56">专用端点</TableHead>
                <TableHead className="w-56">映射</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.models.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-muted-foreground h-24 text-center"
                  >
                    尚未发现模型
                  </TableCell>
                </TableRow>
              ) : (
                group.models.map((model) => (
                  <TableRow key={model.id}>
                    <TableCell>
                      <p className="text-sm font-medium">
                        {model.displayName ?? model.upstreamName}
                      </p>
                      <p className="text-muted-foreground mt-0.5 font-mono text-xs">
                        {model.upstreamName}
                      </p>
                    </TableCell>
                    <TableCell>
                      <ModelStatus model={model} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {model.availabilityBps === null
                        ? "--"
                        : `${(model.availabilityBps / 100).toFixed(2)}%`}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {model.firstTokenP50Ms === null
                        ? "--"
                        : `${formatDuration(model.firstTokenP50Ms)} / ${
                            model.firstTokenP95Ms === null
                              ? "--"
                              : formatDuration(model.firstTokenP95Ms)
                          }`}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {model.sampleCount}
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate font-mono text-xs",
                            !model.baseUrlOverride && "text-muted-foreground",
                          )}
                          title={model.baseUrlOverride ?? group.baseUrl}
                        >
                          {model.baseUrlOverride ?? "使用分组默认"}
                        </span>
                        {!retired && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            title="编辑专用端点"
                            disabled={preview || modelConfigMutation.isPending}
                            onClick={() => openEndpointDialog(model)}
                          >
                            <Link2 />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {retired ? (
                        <span className="text-muted-foreground text-xs">
                          已退役
                        </span>
                      ) : (
                        <Select
                          value={model.modelId ?? "unmapped"}
                          disabled={mapMutation.isPending || preview}
                          onValueChange={(modelId) =>
                            mapMutation.mutate({
                              groupModelId: model.id,
                              modelId: modelId === "unmapped" ? null : modelId,
                              probeEnabled: modelId !== "unmapped",
                            })
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="选择平台模型" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unmapped">不映射</SelectItem>
                            {(catalogQuery.data ?? []).map((catalog) => (
                              <SelectItem key={catalog.id} value={catalog.id}>
                                {catalog.displayName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section>
        <SectionHeader>
          <SectionTitle>最近探测</SectionTitle>
          <SectionDescription>
            只展示脱敏结果，不保存或显示响应正文。
          </SectionDescription>
        </SectionHeader>
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>时间</TableHead>
                <TableHead>模型</TableHead>
                <TableHead>结果</TableHead>
                <TableHead>首字</TableHead>
                <TableHead>总耗时</TableHead>
                <TableHead>说明</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runsQuery.isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-muted-foreground h-24 text-center"
                  >
                    正在加载探测记录
                  </TableCell>
                </TableRow>
              ) : (runsQuery.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-muted-foreground h-24 text-center"
                  >
                    暂无探测记录
                  </TableCell>
                </TableRow>
              ) : (
                (runsQuery.data ?? []).map((run) => (
                  <TableRow key={`${run.cycleId}-${run.groupModelId}`}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {formatDate(run.completedAt)}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{run.modelName}</p>
                      <p className="text-muted-foreground font-mono text-xs">
                        {run.upstreamModelName}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {outcomeLabels[run.outcome]}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {run.firstTokenMs === null
                        ? "--"
                        : formatDuration(run.firstTokenMs)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatDuration(run.totalLatencyMs)}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-64 truncate text-xs">
                      {run.safeErrorSummary ??
                        (run.httpStatus ? `HTTP ${run.httpStatus}` : "--")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Dialog
        open={endpointModel !== null}
        onOpenChange={(open) => {
          if (!open && !modelConfigMutation.isPending) setEndpointModel(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>设置专用端点</DialogTitle>
            <DialogDescription>
              “{endpointModel?.displayName ?? endpointModel?.upstreamName}
              ”可以使用独立的 Base URL；留空时使用分组默认地址。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="group-default-base-url">分组默认地址</Label>
              <Input
                id="group-default-base-url"
                value={group.baseUrl}
                readOnly
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model-base-url-override">模型专用地址</Label>
              <Input
                id="model-base-url-override"
                type="url"
                value={baseUrlOverride}
                placeholder="留空则使用分组默认地址"
                className="font-mono text-xs"
                disabled={modelConfigMutation.isPending}
                onChange={(event) => setBaseUrlOverride(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveEndpoint();
                }}
              />
            </div>
          </div>
          <DialogFooter>
            {endpointModel?.baseUrlOverride && (
              <Button
                type="button"
                variant="outline"
                disabled={modelConfigMutation.isPending}
                onClick={() => {
                  setBaseUrlOverride("");
                  modelConfigMutation.mutate({
                    groupModelId: endpointModel.id,
                    baseUrlOverride: null,
                  });
                }}
              >
                清除专用地址
              </Button>
            )}
            <Button
              type="button"
              disabled={modelConfigMutation.isPending}
              onClick={saveEndpoint}
            >
              {modelConfigMutation.isPending && (
                <LoaderCircle className="animate-spin" />
              )}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionGroup>
  );
}

function Metric({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
}) {
  return (
    <div className="flex min-h-24 items-start justify-between gap-4 border-b px-4 py-4 last:border-b-0 xl:border-r xl:border-b-0 xl:last:border-r-0 sm:[&:nth-child(odd)]:border-r">
      <div>
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-muted-foreground mt-1 text-xs">{detail}</p>
      </div>
      <Icon className="text-muted-foreground mt-0.5 size-4" />
    </div>
  );
}

function GroupStatus({ group }: { group: HubGroup }) {
  const label =
    group.lifecycleStatus === "retired"
      ? "已退役"
      : group.desiredStatus === "paused"
        ? "已暂停"
        : group.lifecycleStatus === "verifying"
          ? "验证中"
          : group.listingStatus === "listed"
            ? "已上架"
            : group.listingStatus === "pending"
              ? "审核中"
              : group.listingStatus === "delisted"
                ? "已下架"
                : "仅监控";
  return <Badge variant="outline">{label}</Badge>;
}

function ModelStatus({ model }: { model: HubGroupModel }) {
  if (model.discoveryStatus !== "active") {
    const label =
      model.discoveryStatus === "unmapped"
        ? "待映射"
        : model.discoveryStatus === "missing"
          ? "目录缺失"
          : "已退役";
    return <Badge variant="outline">{label}</Badge>;
  }
  return <Badge variant="outline">{statusLabels[model.currentStatus]}</Badge>;
}

function formatDuration(value: number) {
  return value < 1_000 ? `${value} ms` : `${(value / 1_000).toFixed(1)} s`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
