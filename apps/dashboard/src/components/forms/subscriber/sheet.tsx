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
  FormSubscriber,
  type SubmitPayload,
  type SubscriberFormValues,
} from "@/components/forms/subscriber/form";
import type { CheckboxTreeItem } from "@/components/ui/checkbox-tree";

type FormSheetSubscriberProps = {
  children?: React.ReactNode;
  defaultValues?: Partial<SubscriberFormValues>;
  items: CheckboxTreeItem[];
  onSubmit: (values: SubmitPayload) => Promise<void>;
  editMode?: boolean;
  title?: string;
  description?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerProps?: Omit<
    React.ComponentProps<typeof FormSheetTrigger>,
    "onSubmit" | "asChild"
  >;
};

export function FormSheetSubscriber({
  children,
  defaultValues,
  onSubmit,
  items,
  editMode = false,
  title,
  description,
  open: controlledOpen,
  onOpenChange,
  triggerProps,
}: FormSheetSubscriberProps) {
  const t = useTranslations("statusPages.subscribers");
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  return (
    <FormSheetWithDirtyProtection open={open} onOpenChange={setOpen}>
      {children ? (
        <FormSheetTrigger {...(triggerProps ?? {})} asChild>
          {children}
        </FormSheetTrigger>
      ) : null}
      <FormSheetContent className="sm:max-w-lg">
        <FormSheetHeader>
          <FormSheetTitle>{title ?? t("sheetTitle")}</FormSheetTitle>
          <FormSheetDescription>
            {description ?? t("sheetDescription")}
          </FormSheetDescription>
        </FormSheetHeader>
        <FormCardGroup className="overflow-y-auto">
          <FormCard className="overflow-auto rounded-none border-none">
            <FormSubscriber
              items={items}
              editMode={editMode}
              onSubmit={async (values) => {
                await onSubmit(values);
                setOpen(false);
              }}
              defaultValues={defaultValues}
              id="subscriber-form"
              className="my-4"
            />
          </FormCard>
        </FormCardGroup>
        <FormSheetFooter>
          <Button type="submit" form="subscriber-form">
            {t("submit")}
          </Button>
        </FormSheetFooter>
      </FormSheetContent>
    </FormSheetWithDirtyProtection>
  );
}
