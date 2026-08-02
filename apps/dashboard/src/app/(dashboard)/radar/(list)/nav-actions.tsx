"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import {
  BadgeDollarSign,
  ClipboardCheck,
  KeyRound,
  Plus,
  ReceiptText,
  ShoppingBag,
} from "lucide-react";
import Link from "next/link";

import { useTRPC } from "@/lib/trpc/client";

export function NavActions() {
  const trpc = useTRPC();
  const accessQuery = useQuery(trpc.hub.access.queryOptions());
  const providersQuery = useQuery(trpc.hub.providers.queryOptions());
  const isPlatformAdmin = accessQuery.data?.isPlatformAdmin === true;
  const hasProvider = (providersQuery.data?.length ?? 0) > 0;

  return (
    <div className="flex items-center gap-2 text-sm">
      {isPlatformAdmin && (
        <>
          <Button size="sm" variant="outline" asChild>
            <Link href="/radar/review">
              <ClipboardCheck className="size-3.5" />
              上架审核
            </Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/radar/models">
              <BadgeDollarSign className="size-3.5" />
              模型价格
            </Link>
          </Button>
        </>
      )}
      <Button size="sm" variant="outline" asChild>
        <Link href="/radar/market">
          <ShoppingBag className="size-3.5" />
          模型市场
        </Link>
      </Button>
      <Button size="sm" variant="outline" asChild>
        <Link href="/radar/tokens">
          <KeyRound className="size-3.5" />
          令牌与订阅
        </Link>
      </Button>
      <Button size="sm" variant="outline" asChild>
        <Link href="/radar/usage">
          <ReceiptText className="size-3.5" />
          用量与账单
        </Link>
      </Button>
      {hasProvider && (
        <Button
          size="sm"
          onClick={() => window.dispatchEvent(new Event("hub:create-group"))}
        >
          <Plus className="size-3.5" />
          新增分组
        </Button>
      )}
    </div>
  );
}
