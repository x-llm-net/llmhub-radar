import type { WorkspacePlan } from "@openstatus/db/src/schema";
import { allPlans } from "@openstatus/db/src/schema/plan/config";
import type { Addons, Limits } from "@openstatus/db/src/schema/plan/schema";
import { getPlansForLimit } from "@openstatus/db/src/schema/plan/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@openstatus/ui/components/ui/dialog";
import { Separator } from "@openstatus/ui/components/ui/separator";
import type { DialogProps } from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/components/common/link";
import { Note, NoteButton } from "@/components/common/note";
import { BillingAddons } from "@/components/content/billing-addons";
import { DataTable } from "@/components/data-table/billing/data-table";
import { useTRPC } from "@/lib/trpc/client";

const PLANS = {
  free: ["starter", "team", "scale"],
  starter: ["team", "scale"],
  team: ["scale"],
  scale: [],
} satisfies Record<WorkspacePlan, WorkspacePlan[]>;

export function UpgradeDialog(
  props: DialogProps & {
    limit?: keyof Limits;
    restrictTo?: WorkspacePlan[];
  },
) {
  const t = useTranslations("dialogs.upgrade");
  const trpc = useTRPC();
  const { data: workspace } = useQuery(trpc.workspace.get.queryOptions());

  if (!workspace) return null;

  const planAddons = allPlans[workspace.plan].addons;

  const getRestrictTo = () => {
    if (props.restrictTo) return props.restrictTo;
    if (props.limit) return getPlansForLimit(workspace.plan, props.limit);
    return PLANS[workspace.plan];
  };

  const restrictTo = getRestrictTo();

  const addon =
    props.limit && Object.prototype.hasOwnProperty.call(planAddons, props.limit)
      ? (props.limit as keyof Addons)
      : null;

  return (
    <Dialog {...props}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("descriptionPrefix")}{" "}
            <Link
              onClick={() => props.onOpenChange?.(false)}
              href="/settings/billing"
            >
              {t("billingSettings")}
            </Link>
            {t("descriptionSuffix")}
          </DialogDescription>
        </DialogHeader>
        {addon && planAddons[addon] ? (
          <>
            <BillingAddons
              label={planAddons[addon].title}
              description={planAddons[addon].description}
              addon={addon}
              workspace={workspace}
            />
            <Separator />
          </>
        ) : null}
        {restrictTo.length === 0 ? (
          <Note>
            <CalendarClock />
            {t("contactToUpgrade")}
            <NoteButton variant="outline" asChild>
              <a
                href="https://openstatus.dev/cal"
                target="_blank"
                rel="noreferrer"
                className="text-nowrap"
              >
                {t("bookCall")}
              </a>
            </NoteButton>
          </Note>
        ) : (
          <DataTable restrictTo={restrictTo} />
        )}
      </DialogContent>
    </Dialog>
  );
}
