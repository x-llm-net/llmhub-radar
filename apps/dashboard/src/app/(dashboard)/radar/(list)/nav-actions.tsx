"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

export function NavActions() {
  const t = useTranslations("radar");

  return (
    <div className="flex items-center gap-2 text-sm">
      <Button size="sm" asChild>
        <Link href="/radar/create">
          <Plus className="size-3.5" />
          {t("createPool")}
        </Link>
      </Button>
    </div>
  );
}
