"use client";

import { Languages, Palette } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { LanguageSwitcher } from "@/components/i18n/language-switcher";
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
import { FormWorkspace } from "@/components/forms/settings/form-workspace";
import { ThemeToggle } from "@/components/theme-toggle";
import { useTRPC } from "@/lib/trpc/client";

export default function Page() {
  const t = useTranslations("settings.general");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: workspace } = useQuery(trpc.workspace.get.queryOptions());
  const updateWorkspaceMutation = useMutation(
    trpc.workspace.updateName.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: trpc.workspace.get.queryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: trpc.workspace.list.queryKey(),
          }),
        ]);
      },
    }),
  );

  if (!workspace) return null;

  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>{t("title")}</SectionTitle>
          <SectionDescription>{t("description")}</SectionDescription>
        </SectionHeader>
        <FormCardGroup>
          <FormWorkspace
            key={workspace.id}
            defaultValues={{ name: workspace.name ?? "" }}
            onSubmit={async (values) => {
              await updateWorkspaceMutation.mutateAsync(values);
            }}
          />

          <FormCard>
            <FormCardHeader>
              <div className="flex items-center gap-2">
                <Languages className="text-muted-foreground size-4" />
                <FormCardTitle>{t("language")}</FormCardTitle>
              </div>
              <FormCardDescription>
                {t("languageDescription")}
              </FormCardDescription>
            </FormCardHeader>
            <FormCardContent className="pb-4">
              <LanguageSwitcher align="start" />
            </FormCardContent>
          </FormCard>

          <FormCard>
            <FormCardHeader>
              <div className="flex items-center gap-2">
                <Palette className="text-muted-foreground size-4" />
                <FormCardTitle>{t("appearance")}</FormCardTitle>
              </div>
              <FormCardDescription>
                {t("appearanceDescription")}
              </FormCardDescription>
            </FormCardHeader>
            <FormCardContent className="pb-4">
              <ThemeToggle />
            </FormCardContent>
          </FormCard>
        </FormCardGroup>
      </Section>
    </SectionGroup>
  );
}
