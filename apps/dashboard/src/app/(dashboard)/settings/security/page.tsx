"use client";

import { BadgeCheck, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import {
  FormCard,
  FormCardContent,
  FormCardDescription,
  FormCardGroup,
  FormCardHeader,
  FormCardTitle,
} from "@/components/forms/form-card";

const items = [
  { key: "encrypted", icon: LockKeyhole },
  { key: "probeOnly", icon: ShieldCheck },
  { key: "noProxy", icon: BadgeCheck },
  { key: "dedicatedKey", icon: KeyRound },
] as const;

export default function Page() {
  const t = useTranslations("settings.security");

  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>{t("title")}</SectionTitle>
          <SectionDescription>{t("description")}</SectionDescription>
        </SectionHeader>
        <FormCardGroup>
          <FormCard>
            <FormCardHeader>
              <FormCardTitle>{t("commitmentTitle")}</FormCardTitle>
              <FormCardDescription>
                {t("commitmentDescription")}
              </FormCardDescription>
            </FormCardHeader>
            <FormCardContent className="pb-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {items.map((item) => (
                  <div
                    key={item.key}
                    className="border-border bg-muted/30 rounded-md border p-3"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <item.icon className="text-muted-foreground size-4" />
                      <p className="font-medium">
                        {t(`items.${item.key}.title`)}
                      </p>
                    </div>
                    <p className="text-muted-foreground font-commit-mono text-sm tracking-tight">
                      {t(`items.${item.key}.description`)}
                    </p>
                  </div>
                ))}
              </div>
            </FormCardContent>
          </FormCard>

          <FormCard>
            <FormCardHeader>
              <FormCardTitle>{t("recommendationTitle")}</FormCardTitle>
              <FormCardDescription>
                {t("recommendationDescription")}
              </FormCardDescription>
            </FormCardHeader>
            <FormCardContent className="pb-4">
              <ul className="text-muted-foreground font-commit-mono list-disc space-y-2 pl-4 text-sm tracking-tight">
                <li>{t("recommendations.lowQuota")}</li>
                <li>{t("recommendations.representativeModel")}</li>
                <li>{t("recommendations.rotateKey")}</li>
              </ul>
            </FormCardContent>
          </FormCard>
        </FormCardGroup>
      </Section>
    </SectionGroup>
  );
}
