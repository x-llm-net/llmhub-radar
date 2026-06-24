"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import { ExternalLink, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

import { NavFeedback } from "@/components/nav/nav-feedback";

export function NavActions() {
  const t = useTranslations("radar");
  const params = useParams<{ slug: string }>();
  const pathname = usePathname();
  const isApiKeyPage = pathname.includes("/api-keys/");

  return (
    <div className="flex items-center gap-2 text-sm">
      <NavFeedback />
      {!isApiKeyPage ? (
        <Button size="sm" asChild>
          <Link href={`/radar/${params.slug}/api-keys/create`}>
            <Plus className="size-3.5" />
            {t("addTokenProbe")}
          </Link>
        </Button>
      ) : null}
      <Button size="sm" variant="outline" asChild>
        <Link href="/status-pages">
          {t("statusPages")}
          <ExternalLink className="size-3.5" />
        </Link>
      </Button>
    </div>
  );
}
