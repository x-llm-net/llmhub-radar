"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface NavTabsProps {
  placement?: "header" | "subnav";
  items: {
    value: string;
    label: string;
    icon: LucideIcon;
    href: string;
  }[];
}

export function NavTabs({ items, placement = "subnav" }: NavTabsProps) {
  const pathname = usePathname();
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";

  return (
    <nav
      className={cn(
        "bg-background overflow-x-auto",
        placement === "header"
          ? "h-14 min-w-0 flex-1"
          : "sticky top-14 z-10 h-[41px] w-full border-b px-2",
      )}
    >
      <ul
        className={cn(
          "inline-flex h-full items-center gap-1 text-sm",
          placement === "header" ? "px-1" : "px-3",
        )}
      >
        {items.map((item) => {
          const normalizedHref = item.href.replace(/\/+$/, "") || "/";
          const isActive =
            normalizedPath === normalizedHref ||
            normalizedPath.startsWith(`${normalizedHref}/`);
          return (
            <li
              key={item.value}
              className={cn(
                "relative flex h-full items-center",
                isActive &&
                  "after:bg-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-px",
              )}
            >
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "font-commit-mono focus-visible:ring-ring relative inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1 tracking-tight whitespace-nowrap focus-visible:ring-2 focus-visible:outline-none",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <item.icon size={16} aria-hidden="true" className="shrink-0" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
