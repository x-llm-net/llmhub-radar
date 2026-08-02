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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  KeyRound,
  LoaderCircle,
  Plus,
  Save,
  X,
} from "lucide-react";
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

type HubToken = RouterOutputs["hub"]["tokens"][number];
type HubAvailableGroup = RouterOutputs["hub"]["availableGroups"][number];

const EMPTY_TOKEN_ID = "00000000-0000-4000-8000-000000000000";

export function Client() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const tokensQuery = useQuery(trpc.hub.tokens.queryOptions());
  const availableGroupsQuery = useQuery(
    trpc.hub.availableGroups.queryOptions(),
  );
  const tokens = useMemo(() => tokensQuery.data ?? [], [tokensQuery.data]);
  const groups = useMemo(
    () => availableGroupsQuery.data ?? [],
    [availableGroupsQuery.data],
  );
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);

  const selectedToken =
    tokens.find((token) => token.id === selectedTokenId) ?? null;
  const preferenceQuery = useQuery({
    ...trpc.hub.tokenPreferences.queryOptions({
      tokenId: selectedTokenId ?? EMPTY_TOKEN_ID,
    }),
    enabled: Boolean(selectedTokenId),
  });
  const balanceQuery = useQuery({
    ...trpc.hub.tokenBalance.queryOptions({
      tokenId: selectedTokenId ?? EMPTY_TOKEN_ID,
    }),
    enabled: Boolean(selectedTokenId),
  });
  const preferences = useMemo(
    () => preferenceQuery.data ?? [],
    [preferenceQuery.data],
  );

  useEffect(() => {
    if (!selectedTokenId && tokens[0]) setSelectedTokenId(tokens[0].id);
    if (
      selectedTokenId &&
      !tokens.some((token) => token.id === selectedTokenId)
    ) {
      setSelectedTokenId(tokens[0]?.id ?? null);
    }
  }, [selectedTokenId, tokens]);

  useEffect(() => {
    setSelectedGroups(
      preferences
        .filter((preference) => preference.enabled)
        .map((preference) => preference.groupId),
    );
  }, [preferences]);

  const invalidateTokens = () =>
    queryClient.invalidateQueries({ queryKey: trpc.hub.tokens.queryKey() });
  const createMutation = useMutation(
    trpc.hub.createToken.mutationOptions({
      onSuccess: async (created) => {
        await invalidateTokens();
        setSelectedTokenId(created.id);
        setNewToken(created.token ?? null);
        setCreateOpen(false);
        setTokenName("");
        toast.success("令牌已创建");
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const revokeMutation = useMutation(
    trpc.hub.revokeToken.mutationOptions({
      onSuccess: async () => {
        await invalidateTokens();
        toast.success("令牌已撤销");
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const savePreferencesMutation = useMutation(
    trpc.hub.replaceTokenPreferences.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.hub.tokenPreferences.queryKey(),
        });
        toast.success("订阅分组已更新");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const toggleGroup = (groupId: string) => {
    setSelectedGroups((current) =>
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId],
    );
  };

  const moveGroup = (groupId: string, offset: -1 | 1) => {
    setSelectedGroups((current) => {
      const from = current.indexOf(groupId);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      const fromValue = next[from];
      const toValue = next[to];
      if (fromValue === undefined || toValue === undefined) return current;
      next[from] = toValue;
      next[to] = fromValue;
      return next;
    });
  };

  const savePreferences = () => {
    if (!selectedToken || selectedToken.status !== "active") return;
    savePreferencesMutation.mutate({
      tokenId: selectedToken.id,
      preferences: selectedGroups.map((groupId, index) => ({
        groupId,
        priority: index,
        weight: 100,
        enabled: true,
      })),
    });
  };

  return (
    <SectionGroup className="max-w-6xl space-y-7 px-4 py-6 lg:px-6 lg:py-8">
      <Section>
        <SectionHeaderRow className="items-start sm:items-start">
          <SectionHeader>
            <SectionTitle className="text-xl">令牌与订阅</SectionTitle>
            <SectionDescription>
              创建自己的 API
              令牌，并指定优先使用的公开分组。首个分组失败后会自动切换。
            </SectionDescription>
          </SectionHeader>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus />
            创建令牌
          </Button>
        </SectionHeaderRow>
      </Section>

      <Section>
        <SectionHeader>
          <SectionTitle>我的令牌</SectionTitle>
          <SectionDescription>
            完整令牌只在创建成功时显示一次。
          </SectionDescription>
        </SectionHeader>
        <div className="mt-4 overflow-hidden rounded-md border">
          {tokensQuery.isLoading ? (
            <LoadingState label="正在加载令牌" />
          ) : tokens.length === 0 ? (
            <EmptyState label="还没有 API 令牌" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>令牌</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>最近使用</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((token) => (
                  <TokenRow
                    key={token.id}
                    token={token}
                    selected={token.id === selectedTokenId}
                    onSelect={() => setSelectedTokenId(token.id)}
                    onRevoke={() => {
                      if (window.confirm(`确认撤销“${token.name}”？`)) {
                        revokeMutation.mutate({ tokenId: token.id });
                      }
                    }}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Section>

      {selectedToken && (
        <Section>
          <SectionHeaderRow className="items-start sm:items-start">
            <SectionHeader>
              <SectionTitle>订阅分组</SectionTitle>
              <SectionDescription>
                账户余额：{formatMicros(balanceQuery.data?.balanceMicros)}{" "}
                {balanceQuery.data?.currency ?? "USD"}
              </SectionDescription>
            </SectionHeader>
            <Button
              size="sm"
              disabled={
                selectedToken.status !== "active" ||
                savePreferencesMutation.isPending
              }
              onClick={savePreferences}
            >
              {savePreferencesMutation.isPending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Save />
              )}
              保存订阅
            </Button>
          </SectionHeaderRow>
          {availableGroupsQuery.isLoading || preferenceQuery.isLoading ? (
            <LoadingState label="正在加载公开分组" />
          ) : groups.length === 0 ? (
            <EmptyState label="暂时没有可订阅的公开分组" />
          ) : (
            <div className="mt-4 space-y-5">
              {selectedGroups.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">优先顺序</p>
                  {selectedGroups.map((groupId, index) => {
                    const group = groups.find(
                      (item) => item.groupId === groupId,
                    );
                    if (!group) return null;
                    return (
                      <div
                        key={group.groupId}
                        className="flex min-h-12 items-center gap-3 rounded-md border px-3 py-2"
                      >
                        <span className="text-muted-foreground w-5 text-center text-xs tabular-nums">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {group.providerName} · {group.groupName}
                          </span>
                          <span className="text-muted-foreground block truncate text-xs">
                            {group.description || "公开分组"}
                          </span>
                        </span>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          title="上移"
                          aria-label="上移"
                          disabled={index === 0}
                          onClick={() => moveGroup(group.groupId, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          title="下移"
                          aria-label="下移"
                          disabled={index === selectedGroups.length - 1}
                          onClick={() => moveGroup(group.groupId, 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          title="移除订阅"
                          aria-label="移除订阅"
                          onClick={() => toggleGroup(group.groupId)}
                        >
                          <X />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="space-y-2">
                <p className="text-sm font-medium">可订阅分组</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {groups
                    .filter((group) => !selectedGroups.includes(group.groupId))
                    .map((group) => (
                      <GroupOption
                        key={group.groupId}
                        group={group}
                        disabled={selectedToken.status !== "active"}
                        onToggle={() => toggleGroup(group.groupId)}
                      />
                    ))}
                </div>
              </div>
            </div>
          )}
        </Section>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建 API 令牌</DialogTitle>
            <DialogDescription>
              令牌用于调用兼容 OpenAI 的 `/v1/chat/completions` 接口。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="hub-token-name">名称</Label>
            <Input
              id="hub-token-name"
              value={tokenName}
              onChange={(event) => setTokenName(event.target.value)}
              placeholder="例如：我的 Claude 客户端"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!tokenName.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate({ name: tokenName.trim() })}
            >
              {createMutation.isPending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <KeyRound />
              )}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={newToken !== null}
        onOpenChange={(open) => !open && setNewToken(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>请立即复制令牌</DialogTitle>
            <DialogDescription>
              关闭后页面不会再次显示完整令牌。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={newToken ?? ""}
              className="font-mono text-xs"
            />
            <Button
              size="icon"
              variant="outline"
              title="复制令牌"
              aria-label="复制令牌"
              onClick={() => {
                if (!newToken) return;
                void navigator.clipboard
                  .writeText(newToken)
                  .then(() => toast.success("令牌已复制"));
              }}
            >
              <Copy />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setNewToken(null)}>
              <Check />
              我已复制
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionGroup>
  );
}

function TokenRow({
  token,
  selected,
  onSelect,
  onRevoke,
}: {
  token: HubToken;
  selected: boolean;
  onSelect: () => void;
  onRevoke: () => void;
}) {
  return (
    <TableRow className={cn(selected && "bg-muted/50")}>
      <TableCell>
        <button
          type="button"
          className="flex items-center gap-2 text-left"
          onClick={onSelect}
        >
          <KeyRound className="text-muted-foreground size-4" />
          <span className="font-medium">{token.name}</span>
        </button>
      </TableCell>
      <TableCell className="font-mono text-xs">{token.prefix}...</TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={
            token.status === "active"
              ? "text-emerald-600"
              : "text-muted-foreground"
          }
        >
          {token.status === "active" ? "可用" : "已撤销"}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {token.lastUsedAt ? formatDate(token.lastUsedAt) : "尚未使用"}
      </TableCell>
      <TableCell className="text-right">
        {token.status === "active" && (
          <Button
            size="icon-sm"
            variant="ghost"
            title="撤销令牌"
            aria-label="撤销令牌"
            onClick={onRevoke}
          >
            <X />
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function GroupOption({
  group,
  disabled,
  onToggle,
}: {
  group: HubAvailableGroup;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-md border p-3",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="checkbox"
        className="mt-1 size-4"
        checked={false}
        disabled={disabled}
        onChange={onToggle}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">
          {group.providerName} · {group.groupName}
        </span>
        <span className="text-muted-foreground mt-1 block truncate text-xs">
          {group.description || "公开分组"}
        </span>
      </span>
    </label>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="text-muted-foreground flex min-h-24 items-center justify-center text-sm">
      <LoaderCircle className="mr-2 size-4 animate-spin" />
      {label}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="text-muted-foreground flex min-h-24 items-center justify-center text-sm">
      {label}
    </div>
  );
}

function formatMicros(value: string | undefined) {
  if (!value) return "0.00";
  return (Number(value) / 1_000_000).toFixed(2);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
