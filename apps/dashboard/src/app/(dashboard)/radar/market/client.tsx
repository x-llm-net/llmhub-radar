"use client";

import type { RouterOutputs } from "@openstatus/api";
import { Badge } from "@openstatus/ui/components/ui/badge";
import { Button } from "@openstatus/ui/components/ui/button";
import { Input } from "@openstatus/ui/components/ui/input";
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
  Check,
  KeyRound,
  LoaderCircle,
  Plus,
  Search,
  ShoppingBag,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

type HubMarketModel = RouterOutputs["hub"]["marketModels"][number];
type HubMarketOffer = HubMarketModel["offers"][number];

const EMPTY_TOKEN_ID = "00000000-0000-4000-8000-000000000000";

export function Client() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const modelsQuery = useQuery(trpc.hub.marketModels.queryOptions());
  const tokensQuery = useQuery(trpc.hub.tokens.queryOptions());
  const models = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data]);
  const tokens = useMemo(
    () => (tokensQuery.data ?? []).filter((token) => token.status === "active"),
    [tokensQuery.data],
  );
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [vendor, setVendor] = useState("all");

  useEffect(() => {
    if (!selectedTokenId && tokens[0]) setSelectedTokenId(tokens[0].id);
    if (
      selectedTokenId &&
      !tokens.some((token) => token.id === selectedTokenId)
    ) {
      setSelectedTokenId(tokens[0]?.id ?? null);
    }
  }, [selectedTokenId, tokens]);

  const preferenceQuery = useQuery({
    ...trpc.hub.tokenPreferences.queryOptions({
      tokenId: selectedTokenId ?? EMPTY_TOKEN_ID,
    }),
    enabled: Boolean(selectedTokenId),
  });
  const preferences = useMemo(
    () => preferenceQuery.data ?? [],
    [preferenceQuery.data],
  );
  const subscribedGroupIds = useMemo(
    () =>
      new Set(
        preferences
          .filter((preference) => preference.enabled)
          .map((preference) => preference.groupId),
      ),
    [preferences],
  );
  const vendors = useMemo(
    () => [...new Set(models.map((model) => model.vendor))].sort(),
    [models],
  );
  const filteredModels = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return models.filter(
      (model) =>
        (vendor === "all" || model.vendor === vendor) &&
        (!normalized ||
          [
            model.displayName,
            model.canonicalName,
            model.vendor,
            model.family,
          ].some((value) => value.toLowerCase().includes(normalized))),
    );
  }, [models, query, vendor]);

  const preferenceMutation = useMutation(
    trpc.hub.replaceTokenPreferences.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.hub.tokenPreferences.queryKey(),
        });
        toast.success("订阅已更新");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const toggleSubscription = (groupId: string) => {
    if (!selectedTokenId) return;
    const current = preferences
      .filter((preference) => preference.enabled)
      .map((preference) => preference.groupId);
    const next = current.includes(groupId)
      ? current.filter((id) => id !== groupId)
      : [...current, groupId];
    preferenceMutation.mutate({
      tokenId: selectedTokenId,
      preferences: next.map((id, index) => ({
        groupId: id,
        priority: index,
        weight: 100,
        enabled: true,
      })),
    });
  };

  return (
    <SectionGroup className="max-w-7xl space-y-6 px-4 py-6 lg:px-6 lg:py-8">
      <Section>
        <SectionHeaderRow className="items-start sm:items-start">
          <SectionHeader>
            <SectionTitle className="text-xl">模型市场</SectionTitle>
            <SectionDescription>
              按实测稳定性、首字速度和当前价格选择分组。
            </SectionDescription>
          </SectionHeader>
          <Button size="sm" variant="outline" asChild>
            <Link href="/radar/tokens">
              <KeyRound />
              管理令牌
            </Link>
          </Button>
        </SectionHeaderRow>
      </Section>

      <Section>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_220px]">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索模型"
              className="pl-9"
            />
          </div>
          <Select value={vendor} onValueChange={setVendor}>
            <SelectTrigger>
              <SelectValue placeholder="全部厂商" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部厂商</SelectItem>
              {vendors.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {tokens.length > 0 ? (
            <Select
              value={selectedTokenId ?? undefined}
              onValueChange={setSelectedTokenId}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择 API 令牌" />
              </SelectTrigger>
              <SelectContent>
                {tokens.map((token) => (
                  <SelectItem key={token.id} value={token.id}>
                    {token.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Button asChild>
              <Link href="/radar/tokens">
                <Plus />
                创建令牌
              </Link>
            </Button>
          )}
        </div>
      </Section>

      {modelsQuery.isLoading || tokensQuery.isLoading ? (
        <LoadingState />
      ) : filteredModels.length === 0 ? (
        <EmptyState hasModels={models.length > 0} />
      ) : (
        <div className="space-y-4">
          {filteredModels.map((model) => (
            <ModelOffers
              key={model.id}
              model={model}
              subscribedGroupIds={subscribedGroupIds}
              subscriptionDisabled={
                !selectedTokenId || preferenceMutation.isPending
              }
              onToggle={toggleSubscription}
            />
          ))}
        </div>
      )}
    </SectionGroup>
  );
}

function ModelOffers({
  model,
  subscribedGroupIds,
  subscriptionDisabled,
  onToggle,
}: {
  model: HubMarketModel;
  subscribedGroupIds: Set<string>;
  subscriptionDisabled: boolean;
  onToggle: (groupId: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-md border">
      <header className="bg-muted/30 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{model.displayName}</h2>
            <Badge variant="outline">{model.vendor}</Badge>
          </div>
          <p className="text-muted-foreground mt-1 truncate font-mono text-xs">
            {model.canonicalName}
          </p>
        </div>
        <p className="text-muted-foreground text-xs tabular-nums">
          官方价 输入 {formatUsdMicros(model.officialInputPriceMicros)} · 输出{" "}
          {formatUsdMicros(model.officialOutputPriceMicros)} / 百万 Token
        </p>
      </header>
      <div className="overflow-x-auto">
        <Table className="min-w-[880px]">
          <TableHeader>
            <TableRow>
              <TableHead>服务商与分组</TableHead>
              <TableHead>当前价格</TableHead>
              <TableHead>7 日稳定性</TableHead>
              <TableHead>首字</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {model.offers.map((offer) => {
              const subscribed = subscribedGroupIds.has(offer.groupId);
              return (
                <TableRow key={offer.groupModelId}>
                  <TableCell>
                    <p className="text-sm font-medium">
                      {offer.providerName} · {offer.groupName}
                    </p>
                    <p className="text-muted-foreground mt-0.5 max-w-80 truncate text-xs">
                      {offer.description ||
                        `${formatMultiplier(offer.multiplierBps)} 分组`}
                    </p>
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    <p>输入 {formatUsdMicros(offer.inputPriceMicros)}</p>
                    <p className="text-muted-foreground mt-0.5">
                      输出 {formatUsdMicros(offer.outputPriceMicros)} ·{" "}
                      {formatMultiplier(offer.multiplierBps)}
                    </p>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatAvailability(offer.availabilityBps)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatLatency(offer.firstTokenP50Ms)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge offer={offer} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant={subscribed ? "secondary" : "outline"}
                      disabled={subscriptionDisabled}
                      onClick={() => onToggle(offer.groupId)}
                    >
                      {subscribed ? <Check /> : <Plus />}
                      {subscribed ? "已订阅" : "订阅"}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function StatusBadge({ offer }: { offer: HubMarketOffer }) {
  const label =
    offer.sampleCount < 4
      ? "观察中"
      : offer.currentStatus === "normal"
        ? "正常"
        : offer.currentStatus === "degraded"
          ? "波动"
          : offer.currentStatus === "stale"
            ? "待更新"
            : offer.currentStatus === "unknown"
              ? "观察中"
              : "异常";
  return (
    <Badge
      variant="outline"
      className={cn(
        label === "正常" && "border-emerald-500/30 text-emerald-600",
        label === "波动" && "border-amber-500/30 text-amber-600",
        label === "异常" && "border-red-500/30 text-red-600",
      )}
    >
      {label}
    </Badge>
  );
}

function LoadingState() {
  return (
    <div className="text-muted-foreground flex min-h-40 items-center justify-center gap-2 rounded-md border text-sm">
      <LoaderCircle className="size-4 animate-spin" />
      正在加载模型
    </div>
  );
}

function EmptyState({ hasModels }: { hasModels: boolean }) {
  return (
    <div className="text-muted-foreground flex min-h-40 flex-col items-center justify-center gap-2 rounded-md border text-sm">
      <ShoppingBag className="size-5" />
      {hasModels ? "没有匹配的模型" : "暂时没有可订阅的模型"}
    </div>
  );
}

function formatUsdMicros(value: string) {
  const amount = Number(value) / 1_000_000;
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amount < 0.01 ? 4 : 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

function formatMultiplier(value: number) {
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value / 10_000)}x`;
}

function formatAvailability(value: number | null) {
  if (value === null) return "--";
  return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}%`;
}

function formatLatency(value: number | null) {
  if (value === null) return "--";
  return value < 1_000 ? `${value}ms` : `${(value / 1_000).toFixed(1)}s`;
}
