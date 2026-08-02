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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@openstatus/ui/components/ui/dropdown-menu";
import { Input } from "@openstatus/ui/components/ui/input";
import { Label } from "@openstatus/ui/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openstatus/ui/components/ui/table";
import { Textarea } from "@openstatus/ui/components/ui/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Check,
  Copy,
  Eye,
  KeyRound,
  LoaderCircle,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  ServerCog,
  ShieldCheck,
  Trash2,
  Waypoints,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";
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

import { ProviderOnboarding } from "./provider-onboarding";

type HubGroup = RouterOutputs["hub"]["groups"][number];
type SupplyStatus =
  | "listed"
  | "monitoring"
  | "paused"
  | "verifying"
  | "retired";

type GroupFormState = {
  name: string;
  description: string;
  baseUrl: string;
  apiKey: string;
  multiplier: string;
};

const emptyForm: GroupFormState = {
  name: "",
  description: "",
  baseUrl: "",
  apiKey: "",
  multiplier: "1.00",
};

const previewGroups: HubGroup[] = [
  {
    id: "2ee83d9b-f11d-4d39-8b1c-e24b91bc7e74",
    providerId: "01ec6ff6-32dc-4713-a644-75c3bd8b2c89",
    providerName: "X-LLM",
    name: "X-LLM Pro",
    description: "Primary lower-latency route",
    baseUrl: "https://api.x-llm.example/v1",
    apiKeyLastFour: "7f2a",
    lifecycleStatus: "ready",
    desiredStatus: "active",
    listingStatus: "listed",
    listingSubmittedAt: "2026-08-01T08:00:00.000Z",
    listingReviewedAt: "2026-08-01T09:00:00.000Z",
    listingReviewedBy: "platform-admin",
    listingReviewNote: null,
    configVersion: 3,
    multiplierBps: 11000,
    balanceMicros: "6350000",
    balanceCurrency: "USD",
    balanceStatus: "available",
    balanceCheckedAt: "2026-08-02T07:45:00.000Z",
    models: [
      {
        id: "7d7c6897-2e8e-47b4-bd2f-fb4a63af13ce",
        modelId: "6cf26409-3fa1-46cd-bc27-1c0f4b4470e4",
        upstreamName: "claude-sonnet-4-6",
        discoveryStatus: "active",
        trafficEnabled: true,
        probeEnabled: true,
        baseUrlOverride: null,
        canonicalName: "claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6",
        availabilityBps: 9975,
        firstTokenP50Ms: 820,
        firstTokenP95Ms: 1480,
        sampleCount: 486,
        currentStatus: "normal",
        lastCheckAt: "2026-08-02T07:50:00.000Z",
      },
      {
        id: "4dd824b4-b1dd-4a78-b220-ecb5d12f92f6",
        modelId: "af45d25c-3c10-458d-8c8d-d3dc267d6f8e",
        upstreamName: "gpt-5.5",
        discoveryStatus: "active",
        trafficEnabled: true,
        probeEnabled: true,
        baseUrlOverride: null,
        canonicalName: "gpt-5-5",
        displayName: "GPT-5.5",
        availabilityBps: 9920,
        firstTokenP50Ms: 960,
        firstTokenP95Ms: 1890,
        sampleCount: 471,
        currentStatus: "normal",
        lastCheckAt: "2026-08-02T07:50:00.000Z",
      },
    ],
    createdAt: "2026-07-22T08:00:00.000Z",
    updatedAt: "2026-08-02T07:50:00.000Z",
  },
  {
    id: "af18667f-7e29-406c-aef2-cfd3e5bd6673",
    providerId: "869823b5-8d9b-4e7b-a4be-f8a7e8576448",
    providerName: "X-LLM",
    name: "Claude Value",
    description: "Lower-price supply group",
    baseUrl: "https://value.x-llm.example/v1",
    apiKeyLastFour: "e91c",
    lifecycleStatus: "ready",
    desiredStatus: "active",
    listingStatus: "private",
    listingSubmittedAt: null,
    listingReviewedAt: null,
    listingReviewedBy: null,
    listingReviewNote: null,
    configVersion: 1,
    multiplierBps: 8600,
    balanceMicros: "1900000",
    balanceCurrency: "USD",
    balanceStatus: "low",
    balanceCheckedAt: "2026-08-02T07:45:00.000Z",
    models: [
      {
        id: "66f16a34-e0cf-4f4d-8f63-bf7ab5494c2a",
        modelId: "ee436d8a-e280-42f3-9b1f-440cc99c5aea",
        upstreamName: "claude-opus-4-6",
        discoveryStatus: "active",
        trafficEnabled: true,
        probeEnabled: true,
        baseUrlOverride: null,
        canonicalName: "claude-opus-4-6",
        displayName: "Claude Opus 4.6",
        availabilityBps: 9880,
        firstTokenP50Ms: 1210,
        firstTokenP95Ms: 2400,
        sampleCount: 328,
        currentStatus: "degraded",
        lastCheckAt: "2026-08-02T07:50:00.000Z",
      },
    ],
    createdAt: "2026-07-29T08:00:00.000Z",
    updatedAt: "2026-08-02T07:50:00.000Z",
  },
  {
    id: "9433a1ce-4054-4177-aa04-1c982fb356e6",
    providerId: "ebb0c5e3-4af0-4f12-982e-f7f00cdcd0a2",
    providerName: "X-LLM",
    name: "Gemini Reserve",
    description: "Paused reserve route",
    baseUrl: "https://reserve.x-llm.example/v1",
    apiKeyLastFour: "44b8",
    lifecycleStatus: "ready",
    desiredStatus: "paused",
    listingStatus: "private",
    listingSubmittedAt: null,
    listingReviewedAt: null,
    listingReviewedBy: null,
    listingReviewNote: null,
    configVersion: 2,
    multiplierBps: 9500,
    balanceMicros: "0",
    balanceCurrency: "USD",
    balanceStatus: "exhausted",
    balanceCheckedAt: "2026-08-02T07:45:00.000Z",
    models: [
      {
        id: "d876f3c5-fd5f-4304-b0e3-b83172526a4d",
        modelId: "26f61c90-1c83-4f28-87bb-d083dff6cfe9",
        upstreamName: "gemini-2.5-pro",
        discoveryStatus: "active",
        trafficEnabled: false,
        probeEnabled: false,
        baseUrlOverride: "https://gemini.x-llm.example/v1",
        canonicalName: "gemini-2-5-pro",
        displayName: "Gemini 2.5 Pro",
        availabilityBps: 9840,
        firstTokenP50Ms: 1560,
        firstTokenP95Ms: 2890,
        sampleCount: 254,
        currentStatus: "unknown",
        lastCheckAt: "2026-08-01T18:20:00.000Z",
      },
    ],
    createdAt: "2026-07-31T08:00:00.000Z",
    updatedAt: "2026-08-01T18:20:00.000Z",
  },
];

const filters: Array<{ value: "all" | SupplyStatus; label: string }> = [
  { value: "all", label: "全部" },
  { value: "listed", label: "已上架" },
  { value: "monitoring", label: "仅监控" },
  { value: "verifying", label: "验证中" },
  { value: "paused", label: "已暂停" },
  { value: "retired", label: "已退役" },
];

const supplyStatusLabel: Record<SupplyStatus, string> = {
  listed: "已上架",
  monitoring: "仅监控",
  paused: "已暂停",
  verifying: "验证中",
  retired: "已退役",
};

const supplyStatusClass: Record<SupplyStatus, string> = {
  listed:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  monitoring:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
  paused:
    "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  verifying:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  retired:
    "border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400",
};

const accents = [
  "bg-emerald-500",
  "bg-blue-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-rose-500",
];

function groupStatus(group: HubGroup): SupplyStatus {
  if (
    group.lifecycleStatus === "retired" ||
    group.desiredStatus === "retired"
  ) {
    return "retired";
  }
  if (group.desiredStatus === "paused") return "paused";
  if (
    group.lifecycleStatus === "draft" ||
    group.lifecycleStatus === "verifying"
  ) {
    return "verifying";
  }
  return group.listingStatus === "listed" ? "listed" : "monitoring";
}

function StatusBadge({ group }: { group: HubGroup }) {
  const status = groupStatus(group);
  return (
    <Badge variant="outline" className={supplyStatusClass[status]}>
      {supplyStatusLabel[status]}
    </Badge>
  );
}

function LineIdentity({ group }: { group: HubGroup }) {
  const accent = accents[hashString(group.id) % accents.length];
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md text-sm font-semibold text-white shadow-xs",
          accent,
        )}
      >
        {group.name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{group.name}</div>
        <div className="text-muted-foreground mt-0.5 max-w-64 truncate font-mono text-xs">
          {group.baseUrl.replace(/^https?:\/\//, "")}
        </div>
      </div>
    </div>
  );
}

function HealthMetric({ group }: { group: HubGroup }) {
  return (
    <div className="text-muted-foreground text-sm">
      <span
        className={cn(
          "mr-2 inline-block size-2 rounded-full",
          group.desiredStatus === "paused" ? "bg-slate-300" : "bg-amber-400",
        )}
      />
      {group.desiredStatus === "paused" ? "探测已暂停" : "等待探测数据"}
    </div>
  );
}

function ModelSummary({ group }: { group: HubGroup }) {
  const activeModels = group.models.filter(
    (model) => model.discoveryStatus !== "retired",
  );
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium">{activeModels.length} 个模型</div>
      <div className="text-muted-foreground max-w-52 truncate text-xs">
        {activeModels.length > 0
          ? activeModels
              .slice(0, 2)
              .map((model) => model.upstreamName)
              .join(" · ")
          : "尚未发现模型"}
      </div>
    </div>
  );
}

function PriceSummary({ group }: { group: HubGroup }) {
  if (group.multiplierBps == null) {
    return <span className="text-muted-foreground text-sm">未定价</span>;
  }
  return (
    <div className="space-y-0.5 tabular-nums">
      <div className="text-sm font-medium">
        {(group.multiplierBps / 10_000).toFixed(2)}×
      </div>
      <div className="text-muted-foreground text-xs">模型目录价 × 倍率</div>
    </div>
  );
}

function BalanceSummary({ group }: { group: HubGroup }) {
  if (group.balanceMicros == null) {
    return <span className="text-muted-foreground text-sm">未获取</span>;
  }
  const value = Number(group.balanceMicros) / 1_000_000;
  return (
    <div className="space-y-0.5 tabular-nums">
      <div
        className={cn(
          "text-sm font-medium",
          group.balanceStatus === "exhausted" && "text-destructive",
        )}
      >
        {formatMoney(value, group.balanceCurrency)}
      </div>
      <div className="text-muted-foreground text-xs">
        {group.balanceCheckedAt
          ? new Date(group.balanceCheckedAt).toLocaleString("zh-CN")
          : "尚未检查"}
      </div>
    </div>
  );
}

function LineMenu({
  group,
  onInspect,
  onEdit,
  onTogglePause,
  onRetire,
  readOnly = false,
}: {
  group: HubGroup;
  onInspect: () => void;
  onEdit: () => void;
  onTogglePause: () => void;
  onRetire: () => void;
  readOnly?: boolean;
}) {
  if (readOnly) return null;
  const status = groupStatus(group);
  const retired = status === "retired";
  const paused = status === "paused";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`管理 ${group.name}`}
          title={`管理 ${group.name}`}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={onInspect}>
          <Eye />
          查看分组
        </DropdownMenuItem>
        {!retired && (
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil />
            编辑分组
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={() =>
            void navigator.clipboard
              .writeText(group.baseUrl)
              .then(() => toast.success("Base URL 已复制"))
          }
        >
          <Copy />
          复制 Base URL
        </DropdownMenuItem>
        {!retired && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onTogglePause}>
              {paused ? <Play /> : <Pause />}
              {paused ? "恢复分组" : "暂停分组"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={onRetire}
            >
              <Trash2 />
              退役分组
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Client({ preview = false }: { preview?: boolean }) {
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const providersOptions = trpc.hub.providers.queryOptions();
  const providersQuery = useQuery({ ...providersOptions, enabled: !preview });
  const providers = useMemo(
    () => (preview ? [] : (providersQuery.data ?? [])),
    [preview, providersQuery.data],
  );
  const activeProvider = providers[0] ?? null;
  const groupsOptions = trpc.hub.groups.queryOptions();
  const groupsQuery = useQuery({
    ...groupsOptions,
    enabled: !preview && Boolean(activeProvider),
  });
  const groups = useMemo(
    () => (preview ? previewGroups : (groupsQuery.data ?? [])),
    [groupsQuery.data, preview],
  );
  const [activeFilter, setActiveFilter] = useState<"all" | SupplyStatus>("all");
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [form, setForm] = useState<GroupFormState>(emptyForm);

  const refreshGroups = () => queryClient.invalidateQueries(groupsOptions);
  const createMutation = useMutation(
    trpc.hub.createGroup.mutationOptions({
      onSuccess: async () => {
        await refreshGroups();
        setFormOpen(false);
        toast.success("分组已创建，模型目录已刷新");
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const updateMutation = useMutation(
    trpc.hub.updateGroup.mutationOptions({
      onSuccess: async () => {
        await refreshGroups();
        setFormOpen(false);
        toast.success("分组已更新");
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const stateMutation = useMutation(
    trpc.hub.setGroupState.mutationOptions({
      onSuccess: async (_data, input) => {
        await refreshGroups();
        toast.success(
          input.action === "pause"
            ? "分组已暂停"
            : input.action === "resume"
              ? "分组已恢复"
              : "分组已退役",
        );
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const openCreate = () => {
    setEditingGroupId(null);
    setForm(emptyForm);
    setFormOpen(true);
  };
  const openEdit = (group: HubGroup) => {
    setEditingGroupId(group.id);
    setForm({
      name: group.name,
      description: group.description,
      baseUrl: group.baseUrl,
      apiKey: "",
      multiplier:
        group.multiplierBps == null
          ? "1.00"
          : (group.multiplierBps / 10_000).toFixed(2),
    });
    setFormOpen(true);
  };

  useEffect(() => {
    window.addEventListener("hub:create-group", openCreate);
    return () => window.removeEventListener("hub:create-group", openCreate);
  }, []);

  const filteredGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return groups.filter((group) => {
      const status = groupStatus(group);
      const matchesStatus = activeFilter === "all" || status === activeFilter;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [
          group.name,
          group.description,
          group.baseUrl,
          ...group.models.map((model) => model.upstreamName),
        ].some((value) => value.toLowerCase().includes(normalizedQuery));
      return matchesStatus && matchesQuery;
    });
  }, [activeFilter, groups, query]);

  const listedCount = groups.filter(
    (group) => groupStatus(group) === "listed",
  ).length;
  const runningCount = groups.filter(
    (group) =>
      group.desiredStatus === "active" && group.lifecycleStatus !== "retired",
  ).length;
  const totalModels = new Set(
    groups.flatMap((group) =>
      group.models
        .filter((model) => model.discoveryStatus !== "retired")
        .map((model) => model.upstreamName),
    ),
  ).size;
  const attentionCount = groups.filter(
    (group) =>
      group.desiredStatus === "paused" ||
      group.balanceStatus === "exhausted" ||
      group.models.some((model) => model.discoveryStatus === "unmapped"),
  ).length;

  const submitForm = (event: FormEvent) => {
    event.preventDefault();
    if (!activeProvider) {
      toast.error("请先创建渠道商");
      return;
    }
    const multiplier = Number(form.multiplier);
    if (!Number.isFinite(multiplier) || multiplier < 0) {
      toast.error("请输入有效的分组倍率");
      return;
    }
    const multiplierBps = Math.round(multiplier * 10_000);
    if (editingGroupId) {
      const current = groups.find((group) => group.id === editingGroupId);
      if (!current) return;
      updateMutation.mutate({
        groupId: editingGroupId,
        name: form.name,
        description: form.description,
        baseUrl: form.baseUrl === current.baseUrl ? undefined : form.baseUrl,
        apiKey: form.apiKey || undefined,
        multiplierBps,
        rediscover: false,
      });
    } else {
      createMutation.mutate({
        providerId: activeProvider.id,
        name: form.name,
        description: form.description,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
        multiplierBps,
      });
    }
  };

  const togglePause = (group: HubGroup) => {
    stateMutation.mutate({
      groupId: group.id,
      action: group.desiredStatus === "paused" ? "resume" : "pause",
    });
  };

  const retireGroup = (group: HubGroup) => {
    if (!window.confirm(`确认退役“${group.name}”？退役后不能自动恢复。`))
      return;
    stateMutation.mutate({ groupId: group.id, action: "retire" });
  };

  const formPending = createMutation.isPending || updateMutation.isPending;

  if (!preview && providersQuery.isLoading) {
    return (
      <div className="text-muted-foreground flex min-h-72 items-center justify-center">
        <LoaderCircle className="mr-2 size-4 animate-spin" />
        正在加载渠道商
      </div>
    );
  }

  if (!preview && providersQuery.isError) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center px-4 text-center">
        <Activity className="text-destructive size-5" />
        <p className="mt-3 text-sm font-medium">渠道商加载失败</p>
        <p className="text-muted-foreground mt-1 text-xs">
          {providersQuery.error.message}
        </p>
        <Button
          className="mt-4"
          size="sm"
          variant="outline"
          onClick={() => providersQuery.refetch()}
        >
          <RefreshCw />
          重试
        </Button>
      </div>
    );
  }

  if (!preview && !activeProvider) return <ProviderOnboarding />;

  return (
    <SectionGroup className="max-w-7xl space-y-7 px-4 py-6 lg:px-6 lg:py-8">
      <Section>
        <SectionHeaderRow className="items-start sm:items-start">
          <SectionHeader>
            <div className="flex items-center gap-2">
              <SectionTitle className="text-xl">分组管理</SectionTitle>
              <Badge variant="secondary">{groups.length}</Badge>
            </div>
            <SectionDescription>
              每个分组包含 Base URL、API Key、可用模型和统一倍率。
            </SectionDescription>
          </SectionHeader>
          <Button size="sm" onClick={openCreate}>
            <Plus />
            新增分组
          </Button>
        </SectionHeaderRow>

        <div className="bg-card mt-5 grid grid-cols-2 overflow-hidden rounded-md border xl:grid-cols-4">
          {[
            {
              label: "正在供给",
              value: listedCount,
              suffix: "个分组",
              icon: Waypoints,
              tone: "text-emerald-600 dark:text-emerald-400",
            },
            {
              label: "运行中",
              value: runningCount,
              suffix: `共 ${groups.length} 个`,
              icon: ShieldCheck,
              tone: "text-blue-600 dark:text-blue-400",
            },
            {
              label: "已发现模型",
              value: totalModels,
              suffix: "去重统计",
              icon: ServerCog,
              tone: "text-violet-600 dark:text-violet-400",
            },
            {
              label: "需要处理",
              value: attentionCount,
              suffix: "暂停、余额或映射",
              icon: Activity,
              tone: "text-amber-600 dark:text-amber-400",
            },
          ].map((metric, index) => (
            <div
              key={metric.label}
              className={cn(
                "flex min-h-24 items-start justify-between gap-4 px-4 py-4",
                index % 2 === 1 && "border-l",
                index >= 2 && "border-t",
                index === 2 && "xl:border-t-0 xl:border-l",
                index === 3 && "xl:border-t-0",
              )}
            >
              <div>
                <p className="text-muted-foreground text-xs">{metric.label}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {metric.value}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {metric.suffix}
                </p>
              </div>
              <metric.icon className={cn("mt-0.5 size-4", metric.tone)} />
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="bg-muted flex w-full gap-1 overflow-x-auto rounded-md p-1 lg:w-auto">
            {filters.map((filter) => {
              const count =
                filter.value === "all"
                  ? groups.length
                  : groups.filter(
                      (group) => groupStatus(group) === filter.value,
                    ).length;
              return (
                <button
                  key={filter.value}
                  type="button"
                  className={cn(
                    "text-muted-foreground hover:text-foreground flex h-8 shrink-0 items-center gap-1.5 rounded px-3 text-sm transition-colors",
                    activeFilter === filter.value &&
                      "bg-background text-foreground shadow-xs",
                  )}
                  onClick={() => setActiveFilter(filter.value)}
                >
                  {filter.label}
                  <span className="text-xs tabular-nums">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="relative w-full lg:w-72">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索分组、模型或 Base URL"
              className="pl-9"
            />
          </div>
        </div>

        {!preview && groupsQuery.isLoading ? (
          <div className="text-muted-foreground mt-4 flex min-h-52 items-center justify-center rounded-md border">
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            正在加载分组
          </div>
        ) : groupsQuery.isError ? (
          <div className="mt-4 flex min-h-52 flex-col items-center justify-center rounded-md border border-dashed px-4 text-center">
            <Activity className="text-destructive size-5" />
            <p className="mt-3 text-sm font-medium">分组加载失败</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {groupsQuery.error.message}
            </p>
            <Button
              className="mt-4"
              size="sm"
              variant="outline"
              onClick={() => groupsQuery.refetch()}
            >
              <RefreshCw />
              重试
            </Button>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="mt-4 flex min-h-52 flex-col items-center justify-center rounded-md border border-dashed px-4 text-center">
            <Search className="text-muted-foreground size-5" />
            <p className="mt-3 text-sm font-medium">
              {groups.length === 0 ? "还没有分组" : "没有找到匹配的分组"}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {groups.length === 0
                ? "创建第一个分组后会自动获取模型。"
                : "尝试更换状态或搜索关键词。"}
            </p>
            {groups.length === 0 && (
              <Button className="mt-4" size="sm" onClick={openCreate}>
                <Plus />
                新增分组
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="mt-4 hidden overflow-hidden rounded-md border lg:block">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="w-[26%]">分组</TableHead>
                    <TableHead>供给状态</TableHead>
                    <TableHead>7 日质量</TableHead>
                    <TableHead>模型</TableHead>
                    <TableHead>分组倍率</TableHead>
                    <TableHead>上游余额</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredGroups.map((group) => (
                    <TableRow key={group.id} className="group h-[76px]">
                      <TableCell>
                        <LineIdentity group={group} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge group={group} />
                      </TableCell>
                      <TableCell>
                        <HealthMetric group={group} />
                      </TableCell>
                      <TableCell>
                        <ModelSummary group={group} />
                      </TableCell>
                      <TableCell>
                        <PriceSummary group={group} />
                      </TableCell>
                      <TableCell>
                        <BalanceSummary group={group} />
                      </TableCell>
                      <TableCell className="pr-3 text-right">
                        <LineMenu
                          group={group}
                          onInspect={() =>
                            router.push(`/radar/groups/${group.id}`)
                          }
                          onEdit={() => openEdit(group)}
                          onTogglePause={() => togglePause(group)}
                          onRetire={() => retireGroup(group)}
                          readOnly={preview}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-4 grid gap-3 lg:hidden">
              {filteredGroups.map((group) => (
                <article
                  key={group.id}
                  className="bg-card rounded-md border p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <LineIdentity group={group} />
                    <LineMenu
                      group={group}
                      onInspect={() => router.push(`/radar/groups/${group.id}`)}
                      onEdit={() => openEdit(group)}
                      onTogglePause={() => togglePause(group)}
                      onRetire={() => retireGroup(group)}
                      readOnly={preview}
                    />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <StatusBadge group={group} />
                    <Badge variant="outline">
                      <KeyRound className="mr-1 size-3" />
                      ••••{group.apiKeyLastFour}
                    </Badge>
                    <Badge variant="outline">
                      {group.models.length} 个模型
                    </Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3 border-t pt-4">
                    <div>
                      <p className="text-muted-foreground text-xs">7 日质量</p>
                      <div className="mt-1.5">
                        <HealthMetric group={group} />
                      </div>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">价格</p>
                      <div className="mt-1.5">
                        <PriceSummary group={group} />
                      </div>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">余额</p>
                      <div className="mt-1.5">
                        <BalanceSummary group={group} />
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </Section>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submitForm}>
            <DialogHeader>
              <DialogTitle>
                {editingGroupId ? "编辑分组" : "新增分组"}
              </DialogTitle>
              <DialogDescription>
                保存时会验证凭证并同步上游模型目录。
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-5">
              <div className="grid gap-2">
                <Label htmlFor="hub-group-name">分组名称</Label>
                <Input
                  id="hub-group-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  required
                  maxLength={120}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="hub-group-description">说明</Label>
                <Textarea
                  id="hub-group-description"
                  value={form.description}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  maxLength={500}
                  rows={2}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="hub-group-base-url">Base URL</Label>
                <Input
                  id="hub-group-base-url"
                  type="url"
                  value={form.baseUrl}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      baseUrl: event.target.value,
                    }))
                  }
                  placeholder="https://api.example.com/v1"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="hub-group-api-key">API Key</Label>
                <Input
                  id="hub-group-api-key"
                  type="password"
                  autoComplete="off"
                  value={form.apiKey}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      apiKey: event.target.value,
                    }))
                  }
                  placeholder={editingGroupId ? "留空则不修改" : "sk-..."}
                  required={!editingGroupId}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="hub-group-multiplier">分组倍率</Label>
                  <Input
                    id="hub-group-multiplier"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.multiplier}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        multiplier: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={formPending}>
                {formPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Check />
                )}
                {editingGroupId ? "保存" : "创建分组"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SectionGroup>
  );
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function formatMoney(value: number, currency: string | null) {
  if (!currency) return value.toFixed(2);
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
