"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";

import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { FormComponentsUpdate } from "@/components/forms/components/update";
import { useTRPC } from "@/lib/trpc/client";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("statusPages.components");
  const trpc = useTRPC();
  const { data: statusPage } = useQuery(
    trpc.page.get.queryOptions({ id: Number.parseInt(id) }),
  );

  if (!statusPage) return null;

  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>{statusPage.title}</SectionTitle>
          <SectionDescription>{t("description")}</SectionDescription>
        </SectionHeader>
        <FormComponentsUpdate />
      </Section>
    </SectionGroup>
  );
}
