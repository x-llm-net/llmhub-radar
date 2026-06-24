"use client";

import { useTranslations } from "next-intl";

import { FormAlertDialog } from "@/components/forms/form-alert-dialog";
import {
  FormCard,
  FormCardDescription,
  FormCardFooter,
  FormCardHeader,
  FormCardTitle,
} from "@/components/forms/form-card";

export function FormDangerZone({
  onSubmit,
  title,
}: {
  onSubmit: () => Promise<void>;
  title: string;
}) {
  const t = useTranslations("monitors.form");
  return (
    <FormCard variant="destructive">
      <FormCardHeader>
        <FormCardTitle>{t("dangerZone")}</FormCardTitle>
        <FormCardDescription>{t("dangerDescription")}</FormCardDescription>
      </FormCardHeader>
      <FormCardFooter variant="destructive" className="justify-end">
        <FormAlertDialog confirmationValue={title} submitAction={onSubmit} />
      </FormCardFooter>
    </FormCard>
  );
}
