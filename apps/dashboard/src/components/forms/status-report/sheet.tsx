"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import { Separator } from "@openstatus/ui/components/ui/separator";
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
  FormStatusReport,
  type FormValues,
} from "@/components/forms/status-report/form";
import type { CheckboxTreeItem } from "@/components/ui/checkbox-tree";

export function FormSheetStatusReport({
  children,
  defaultValues,
  onSubmit,
  items,
  warning,
}: Omit<React.ComponentProps<typeof FormSheetTrigger>, "onSubmit"> & {
  defaultValues?: FormValues;
  onSubmit: (values: FormValues) => Promise<void>;
  items: CheckboxTreeItem[];
  warning?: React.ReactNode;
}) {
  const t = useTranslations("statusPages.reports.sheet");
  const [open, setOpen] = useState(false);

  return (
    <FormSheetWithDirtyProtection open={open} onOpenChange={setOpen}>
      <FormSheetTrigger asChild>{children}</FormSheetTrigger>
      <FormSheetContent className="sm:max-w-lg">
        <FormSheetHeader>
          <FormSheetTitle>{t("title")}</FormSheetTitle>
          <FormSheetDescription>{t("description")}</FormSheetDescription>
        </FormSheetHeader>
        {warning ? (
          <>
            <p className="text-warning px-4 py-4 text-sm">{warning}</p>
            <Separator />
          </>
        ) : null}
        <FormCardGroup className="overflow-y-scroll">
          <FormCard className="overflow-auto rounded-none border-none">
            <FormStatusReport
              id="status-report-form"
              className="my-4"
              onSubmit={async (values) => {
                await onSubmit(values);
                setOpen(false);
              }}
              defaultValues={defaultValues}
              items={items}
            />
          </FormCard>
        </FormCardGroup>
        <FormSheetFooter>
          <Button type="submit" form="status-report-form">
            {t("submit")}
          </Button>
        </FormSheetFooter>
      </FormSheetContent>
    </FormSheetWithDirtyProtection>
  );
}
