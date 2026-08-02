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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openstatus/ui/components/ui/table";
import { Textarea } from "@openstatus/ui/components/ui/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LoaderCircle, Pencil, ShieldX } from "lucide-react";
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

type ModelPrice = RouterOutputs["hub"]["modelPrices"][number];
export type HubModelPricePreviewData = ModelPrice[];
type PriceComponent =
  | "input_text"
  | "output_text"
  | "cache_read"
  | "cache_write";
type PriceValues = Record<PriceComponent, string>;

const PRICE_COMPONENTS: Array<{ component: PriceComponent; label: string }> = [
  { component: "input_text", label: "输入价格" },
  { component: "output_text", label: "输出价格" },
  { component: "cache_read", label: "缓存读取" },
  { component: "cache_write", label: "缓存写入" },
];

const EMPTY_PRICES: PriceValues = {
  input_text: "",
  output_text: "",
  cache_read: "",
  cache_write: "",
};

const MICROS_PER_USD = BigInt(1_000_000);
const MAX_AMOUNT_MICROS = BigInt("9223372036854775807");

const statusLabels: Record<ModelPrice["status"], string> = {
  active: "在售",
  deprecated: "即将停用",
  retired: "已退役",
};

const statusClasses: Record<ModelPrice["status"], string> = {
  active:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  deprecated:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  retired:
    "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
};

function amountMicrosToUsd(value: string) {
  const micros = BigInt(value);
  const whole = micros / MICROS_PER_USD;
  const fraction = (micros % MICROS_PER_USD)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function usdToAmountMicros(value: string) {
  const normalized = value.trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(normalized);
  if (!match) {
    throw new Error("请输入非负金额，小数最多保留 6 位");
  }

  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(6, "0");
  const amountMicros = BigInt(`${whole}${fraction}`);
  if (amountMicros > MAX_AMOUNT_MICROS) {
    throw new Error("金额超出可保存范围");
  }
  return amountMicros.toString();
}

function getComponentAmount(model: ModelPrice, component: PriceComponent) {
  return model.price?.components.find((item) => item.component === component)
    ?.amountMicros;
}

function formatPrice(model: ModelPrice, component: PriceComponent) {
  const amount = getComponentAmount(model, component);
  return amount == null ? "-" : `$${amountMicrosToUsd(amount)}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function initialPriceValues(model: ModelPrice): PriceValues {
  return Object.fromEntries(
    PRICE_COMPONENTS.map(({ component }) => {
      const amount = getComponentAmount(model, component);
      return [component, amount == null ? "" : amountMicrosToUsd(amount)];
    }),
  ) as PriceValues;
}

export function Client({
  previewData,
}: {
  previewData?: HubModelPricePreviewData;
} = {}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ModelPrice | null>(null);
  const [prices, setPrices] = useState<PriceValues>(EMPTY_PRICES);
  const [changeReason, setChangeReason] = useState("");

  const accessQuery = useQuery({
    ...trpc.hub.access.queryOptions(),
    ...(previewData
      ? { enabled: false, initialData: { isPlatformAdmin: true } }
      : {}),
  });
  const pricesQuery = useQuery({
    ...trpc.hub.modelPrices.queryOptions(),
    enabled: previewData ? false : accessQuery.data?.isPlatformAdmin === true,
    initialData: previewData,
  });
  const updatePrice = useMutation(
    trpc.hub.updateModelPrice.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.hub.modelPrices.queryKey(),
        });
        toast.success("官方价格已更新");
        closeDialog();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const openDialog = (model: ModelPrice) => {
    setSelected(model);
    setPrices(initialPriceValues(model));
    setChangeReason("");
  };

  const closeDialog = () => {
    setSelected(null);
    setPrices(EMPTY_PRICES);
    setChangeReason("");
  };

  const submit = () => {
    if (!selected) return;

    try {
      if (!prices.input_text.trim() || !prices.output_text.trim()) {
        toast.error("输入价格和输出价格必须填写");
        return;
      }
      const components = PRICE_COMPONENTS.flatMap(({ component }) => {
        const value = prices[component].trim();
        return value
          ? [{ component, amountMicros: usdToAmountMicros(value) }]
          : [];
      });
      if (components.length === 0) {
        toast.error("请至少填写一项价格");
        return;
      }
      if (!changeReason.trim()) {
        toast.error("请填写变更原因");
        return;
      }

      updatePrice.mutate({
        modelId: selected.id,
        components,
        changeReason: changeReason.trim(),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "价格格式不正确");
    }
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
          <SectionTitle>无权访问官方模型价格</SectionTitle>
          <SectionDescription>
            该页面仅供平台管理员维护官方模型价格。
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

  const models = pricesQuery.data ?? [];

  return (
    <SectionGroup className="max-w-7xl space-y-6 px-4 py-6 lg:px-6 lg:py-8">
      <SectionHeaderRow>
        <SectionHeader>
          <SectionTitle>官方模型价格</SectionTitle>
          <SectionDescription>
            维护平台统一的美元计价，所有金额均为每百万 token。
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
        {pricesQuery.isLoading ? (
          <div className="text-muted-foreground flex min-h-52 items-center justify-center text-sm">
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            正在加载模型价格
          </div>
        ) : pricesQuery.isError ? (
          <div className="flex min-h-52 flex-col items-center justify-center rounded-md border border-dashed px-4 text-center">
            <p className="text-sm font-medium">模型价格加载失败</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {pricesQuery.error.message}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => pricesQuery.refetch()}
            >
              重试
            </Button>
          </div>
        ) : models.length ? (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>模型</TableHead>
                  <TableHead>厂商</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">输入价</TableHead>
                  <TableHead className="text-right">输出价</TableHead>
                  <TableHead className="text-right">缓存读 / 写</TableHead>
                  <TableHead>更新时间</TableHead>
                  <TableHead className="w-16 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map((model) => (
                  <TableRow key={model.id}>
                    <TableCell>
                      <p className="min-w-40 font-medium">
                        {model.displayName}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {model.canonicalName}
                      </p>
                    </TableCell>
                    <TableCell>{model.vendor}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={statusClasses[model.status]}
                      >
                        {statusLabels[model.status]}
                      </Badge>
                    </TableCell>
                    {model.price ? (
                      <>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatPrice(model, "input_text")}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatPrice(model, "output_text")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatPrice(model, "cache_read")} /{" "}
                          {formatPrice(model, "cache_write")}
                        </TableCell>
                        <TableCell className="text-muted-foreground min-w-36 text-xs tabular-nums">
                          {formatDate(model.price.effectiveFrom)}
                        </TableCell>
                      </>
                    ) : (
                      <TableCell
                        colSpan={4}
                        className="text-muted-foreground text-center text-sm"
                      >
                        未定价
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="编辑价格"
                        onClick={() => openDialog(model)}
                      >
                        <Pencil />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="text-muted-foreground flex min-h-52 items-center justify-center rounded-md border border-dashed px-4 text-center text-sm">
            当前没有官方模型
          </div>
        )}

        {!pricesQuery.isLoading && !pricesQuery.isError ? (
          <p className="text-muted-foreground mt-3 text-xs">
            共 {models.length} 个模型
          </p>
        ) : null}
      </Section>

      <Dialog
        open={selected != null}
        onOpenChange={(open) => {
          if (!open && !updatePrice.isPending) closeDialog();
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>编辑官方价格</DialogTitle>
            <DialogDescription>
              {selected
                ? `${selected.displayName} · 美元 / 百万 token`
                : "美元 / 百万 token"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 sm:grid-cols-2">
            {PRICE_COMPONENTS.map(({ component, label }) => (
              <div key={component} className="space-y-2">
                <Label htmlFor={`model-price-${component}`}>{label}</Label>
                <div className="relative">
                  <span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm">
                    $
                  </span>
                  <Input
                    id={`model-price-${component}`}
                    inputMode="decimal"
                    className="pl-7 tabular-nums"
                    placeholder="未设置"
                    value={prices[component]}
                    disabled={updatePrice.isPending}
                    onChange={(event) =>
                      setPrices((current) => ({
                        ...current,
                        [component]: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="model-price-reason">变更原因</Label>
            <Textarea
              id="model-price-reason"
              className="min-h-20 resize-y"
              maxLength={500}
              placeholder="例如：同步官方 2026-08 定价"
              value={changeReason}
              disabled={updatePrice.isPending}
              onChange={(event) => setChangeReason(event.target.value)}
            />
          </div>

          <p className="text-muted-foreground text-xs">
            留空表示该计费项不参与当前价格；最多支持 6 位小数。
          </p>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={updatePrice.isPending}
              onClick={closeDialog}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={updatePrice.isPending}
              onClick={submit}
            >
              {updatePrice.isPending ? (
                <LoaderCircle className="animate-spin" />
              ) : null}
              保存价格
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionGroup>
  );
}
