import { Badge } from "@openstatus/ui/components/ui/badge";
import {
  ChartNoAxesCombined,
  CircleUserRound,
  LayoutDashboard,
  ReceiptText,
  Settings,
  Waypoints,
} from "lucide-react";
import { notFound } from "next/navigation";

import { Client } from "@/app/(dashboard)/radar/(list)/client";
import { Wordmark } from "@/components/layout/wordmark";
import { cn } from "@/lib/utils";

const navigation = [
  { label: "概览", icon: LayoutDashboard },
  { label: "分组管理", icon: Waypoints, active: true },
  { label: "公开榜单", icon: ChartNoAxesCombined },
  { label: "用量结算", icon: ReceiptText },
  { label: "设置", icon: Settings },
];

export default function SupplyLinesPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <div className="bg-background min-h-screen lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="bg-sidebar hidden min-h-screen border-r lg:flex lg:flex-col">
        <div className="flex h-14 items-center border-b px-4">
          <Wordmark showText size={32} href="/preview/groups" />
        </div>

        <nav className="flex-1 px-3 py-5">
          <p className="text-muted-foreground px-2 pb-2 text-xs font-medium">
            工作台
          </p>
          <div className="space-y-1">
            {navigation.map((item) => (
              <div
                key={item.label}
                className={cn(
                  "text-muted-foreground flex h-9 items-center gap-3 rounded-md px-3 text-sm",
                  item.active && "bg-accent text-accent-foreground font-medium",
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </div>
            ))}
          </div>
        </nav>

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
          <div className="flex items-center gap-3">
            <Wordmark className="lg:hidden" size={24} href="/preview/groups" />
            <div className="flex items-center gap-2 text-sm">
              <Waypoints className="text-muted-foreground size-4" />
              <span className="font-medium">分组管理</span>
            </div>
          </div>
          <Badge variant="outline" className="text-muted-foreground">
            新版预览
          </Badge>
        </header>

        <main>
          <Client />
        </main>
      </div>
    </div>
  );
}
