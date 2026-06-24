"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { FormCard, FormCardGroup } from "@/components/forms/form-card";
import {
  FormSheetContent,
  FormSheetDescription,
  FormSheetFooter,
  FormSheetHeader,
  FormSheetTitle,
  FormSheetTrigger,
  FormSheetWithDirtyProtection,
} from "@/components/forms/form-sheet";
import {
  FormStatusReportUpdate,
  type FormValues,
} from "@/components/forms/status-report-update/form";

export function FormSheetStatusReportUpdate({
  children,
  defaultValues,
  onSubmit,
  components,
  allowUnsetImpacts,
}: Omit<React.ComponentProps<typeof FormSheetTrigger>, "onSubmit"> & {
  defaultValues?: Partial<FormValues>;
  onSubmit: (values: FormValues) => Promise<void>;
  components?: { id: number; name: string }[];
  allowUnsetImpacts?: boolean;
}) {
  const t = useTranslations("statusPages.reports.sheet");
  const [open, setOpen] = useState(false);
  return (
    <FormSheetWithDirtyProtection open={open} onOpenChange={setOpen}>
      <FormSheetTrigger asChild>{children}</FormSheetTrigger>
      <FormSheetContent className="sm:max-w-lg">
        <FormSheetHeader>
          <FormSheetTitle>{t("updateTitle")}</FormSheetTitle>
          <FormSheetDescription>{t("description")}</FormSheetDescription>
        </FormSheetHeader>
        <FormCardGroup className="overflow-y-scroll">
          <FormCard className="overflow-auto rounded-none border-none">
            <FormStatusReportUpdate
              id="status-report-update-form"
              className="my-4"
              onSubmit={async (values) => {
                await onSubmit(values);
                setOpen(false);
              }}
              defaultValues={defaultValues}
              components={components}
              allowUnsetImpacts={allowUnsetImpacts}
            />
          </FormCard>
        </FormCardGroup>
        <FormSheetFooter>
          <Button type="submit" form="status-report-update-form">
            {t("submit")}
          </Button>
        </FormSheetFooter>
      </FormSheetContent>
    </FormSheetWithDirtyProtection>
  );
}
