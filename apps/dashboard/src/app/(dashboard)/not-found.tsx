import { Activity, Cog, LayoutGrid, PanelTop } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { WorkspaceSwitcher } from "@/components/nav/workspace-switcher";

export default async function NotFound() {
  const nav = await getTranslations("nav");
  const t = await getTranslations("errors");
  const quickLinks = [
    { name: nav("overview"), href: "/overview", icon: LayoutGrid },
    { name: nav("monitors"), href: "/monitors", icon: Activity },
    { name: nav("statusPages"), href: "/status-pages", icon: PanelTop },
    { name: nav("settings"), href: "/settings/general", icon: Cog },
  ];

  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center p-4 md:p-8">
      <div className="border-border bg-sidebar mx-auto w-full max-w-md rounded-lg border">
        <div className="flex flex-col gap-6 p-6 sm:p-8">
          <div className="flex flex-col gap-1 text-center">
            <p className="text-destructive font-mono">{t("notFoundLabel")}</p>
            <h2 className="font-cal text-foreground text-2xl">
              {t("notFoundTitle")}
            </h2>
            <p className="text-muted-foreground text-sm">
              {t("notFoundDescription")}
            </p>
          </div>
          <WorkspaceSwitcher
            className="border-border bg-background rounded-md border"
            side="bottom"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            {quickLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="border-border bg-background font-commit-mono text-muted-foreground hover:bg-accent hover:text-accent-foreground flex items-center gap-2 rounded-md border px-4 py-2 text-sm transition-colors"
              >
                <link.icon className="h-4 w-4" />
                {link.name}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
