"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import { useTranslations } from "next-intl";
import { useCopyToClipboard } from "@openstatus/ui/hooks/use-copy-to-clipboard";
import { Check, Copy } from "lucide-react";
import { z } from "zod";

import {
  FormCard,
  FormCardContent,
  FormCardDescription,
  FormCardFooter,
  FormCardFooterInfo,
  FormCardHeader,
  FormCardTitle,
} from "@/components/forms/form-card";
import { FormDialogSupportContact } from "@/components/forms/support-contact/dialog";

const schema = z.object({
  slug: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

export function FormSlug({ defaultValues }: { defaultValues?: FormValues }) {
  const t = useTranslations("settings.forms");
  const { copy, isCopied } = useCopyToClipboard();
  console.log({ defaultValues, schema });

  return (
    <FormCard>
      <FormCardHeader>
        <FormCardTitle>{t("slug")}</FormCardTitle>
        <FormCardDescription>
          {t("slugDescription")}
        </FormCardDescription>
      </FormCardHeader>
      <FormCardContent>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            copy(defaultValues?.slug ?? t("unknownSlug"), {
              successMessage: t("copiedSlug"),
            })
          }
        >
          {defaultValues?.slug ?? t("unknownSlug")}
          {isCopied ? (
            <Check size={16} className="text-muted-foreground" />
          ) : (
            <Copy size={16} className="text-muted-foreground" />
          )}
        </Button>
      </FormCardContent>
      <FormCardFooter className="[&>:last-child]:ml-0">
        <FormCardFooterInfo>
          {t("slugHelpPrefix")}{" "}
          <FormDialogSupportContact>
            <Button
              variant="ghost"
              size="sm"
              className="text-accent-foreground px-0 py-0 hover:bg-transparent dark:hover:bg-transparent"
            >
              {t("supportCta")}
            </Button>
          </FormDialogSupportContact>{" "}
          {t("slugHelpSuffix")}
        </FormCardFooterInfo>
      </FormCardFooter>
    </FormCard>
  );
}
