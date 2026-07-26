"use client";

import { cn } from "@openstatus/ui/lib/utils";
import { Activity, FileText, LayoutDashboard } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

type WorkspaceSection = "overview" | "profile" | "status";

export function WorkspaceNav() {
  const t = useTranslations("radar");
  const params = useParams<{ slug: string }>();
  const pathname = usePathname();
  const rootHref = `/radar/${params.slug}`;

  let active: WorkspaceSection = "overview";
  if (pathname.endsWith("/edit") && !pathname.includes("/api-keys/")) {
    active = "profile";
  } else if (
    pathname.endsWith("/embed") ||
    pathname.includes("/announcements") ||
    pathname.includes("/subscribers")
  ) {
    active = "status";
  }

  const items: Array<{
    key: WorkspaceSection;
    label: string;
    href: string;
    icon: typeof LayoutDashboard;
  }> = [
    {
      key: "overview",
      label: t("workspaceOverview"),
      href: rootHref,
      icon: LayoutDashboard,
    },
    {
      key: "profile",
      label: t("workspaceProfile"),
      href: `${rootHref}/edit`,
      icon: FileText,
    },
    {
      key: "status",
      label: t("workspaceStatus"),
      href: `${rootHref}/embed`,
      icon: Activity,
    },
  ];

  return (
    <nav className="bg-background sticky top-14 z-[9] border-b">
      <div className="mx-auto flex w-full max-w-6xl overflow-x-auto px-4">
        {items.map((item) => {
          const Icon = item.icon;
          const selected = active === item.key;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={selected ? "page" : undefined}
              className={cn(
                "text-muted-foreground hover:text-foreground relative flex h-12 shrink-0 items-center gap-2 px-3 text-sm font-medium transition-colors",
                selected && "text-foreground",
              )}
            >
              <Icon className="size-4" />
              {item.label}
              {selected ? (
                <span className="bg-primary absolute inset-x-3 bottom-0 h-0.5" />
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
