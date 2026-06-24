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
import { FormMonitorUpdate } from "@/components/forms/monitor/update";
import { useTRPC } from "@/lib/trpc/client";

export default function Page() {
  const t = useTranslations("monitors.edit");
  const { id } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const { data: monitor } = useQuery(
    trpc.monitor.get.queryOptions({ id: Number.parseInt(id) }),
  );

  if (!monitor) return null;

  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>{monitor.name}</SectionTitle>
          <SectionDescription>{t("description")}</SectionDescription>
        </SectionHeader>
        <FormMonitorUpdate />
      </Section>
    </SectionGroup>
  );
}
