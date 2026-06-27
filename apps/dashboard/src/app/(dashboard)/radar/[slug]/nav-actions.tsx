"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import { ExternalLink, Megaphone, Plus, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

export function NavActions({ publicHref }: { publicHref: string }) {
  const t = useTranslations("radar");
  const notificationsT = useTranslations("notifications");
  const params = useParams<{ slug: string }>();
  const pathname = usePathname();
  const isApiKeyPage = pathname.includes("/api-keys/");
  const isAnnouncementsPage = pathname.includes("/announcements");
  const isSubscribersPage = pathname.includes("/subscribers");
  const showDetailActions =
    !isApiKeyPage && !isAnnouncementsPage && !isSubscribersPage;

  return (
    <div className="flex items-center gap-2 text-sm">
      {showDetailActions ? (
        <Button size="sm" variant="outline" asChild>
          <Link href={`/radar/${params.slug}/announcements`}>
            <Megaphone className="size-3.5" />
            {t("announcements")}
          </Link>
        </Button>
      ) : null}
      {showDetailActions ? (
        <Button size="sm" variant="outline" asChild>
          <Link href={`/radar/${params.slug}/subscribers`}>
            <Users className="size-3.5" />
            {notificationsT("manageSubscribers")}
          </Link>
        </Button>
      ) : null}
      {showDetailActions ? (
        <Button size="sm" asChild>
          <Link href={`/radar/${params.slug}/api-keys/create`}>
            <Plus className="size-3.5" />
            {t("addTokenProbe")}
          </Link>
        </Button>
      ) : null}
      {showDetailActions ? (
        <Button size="sm" variant="outline" asChild>
          <Link href={publicHref} target="_blank">
            {t("statusPages")}
            <ExternalLink className="size-3.5" />
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
