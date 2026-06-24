"use client";

import type { RouterOutputs } from "@openstatus/api";
import type { PrivateLocation } from "@openstatus/db/src/schema";
import { Button } from "@openstatus/ui/components/ui/button";
import { Separator } from "@openstatus/ui/components/ui/separator";
import { useCopyToClipboard } from "@openstatus/ui/hooks/use-copy-to-clipboard";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  DataTableSheet,
  DataTableSheetContent,
  DataTableSheetFooter,
  DataTableSheetHeader,
  DataTableSheetTitle,
} from "@/components/data-table/data-table-sheet";

import { DataTableBasics } from "./data-table-basics";

type ResponseLog = RouterOutputs["tinybird"]["get"]["data"][number];

export function Sheet({
  data,
  privateLocations,
  onClose,
  showCopyUrl = true,
}: {
  data: ResponseLog | null;
  privateLocations?: PrivateLocation[];
  onClose: () => void;
  showCopyUrl?: boolean;
}) {
  const t = useTranslations("monitors.logs");
  const { copy, isCopied } = useCopyToClipboard();
  if (!data) return null;

  return (
    <DataTableSheet defaultOpen onOpenChange={(open) => !open && onClose()}>
      <DataTableSheetContent className="sm:max-w-lg">
        <DataTableSheetHeader className="px-2">
          <DataTableSheetTitle>{t("sheetTitle")}</DataTableSheetTitle>
        </DataTableSheetHeader>
        <DataTableBasics data={data} privateLocations={privateLocations} />
        {showCopyUrl ? (
          <>
            <Separator />
            <DataTableSheetFooter>
              <Button
                variant="outline"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    copy(window.location.href, {
                      withToast: false,
                    });
                  }
                }}
              >
                {t("copyUrl")}
                {isCopied ? <Check /> : <Copy />}
              </Button>
            </DataTableSheetFooter>
          </>
        ) : null}
      </DataTableSheetContent>
    </DataTableSheet>
  );
}
