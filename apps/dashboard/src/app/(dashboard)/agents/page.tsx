"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useTranslations } from "next-intl";

import { Code } from "@/components/common/code";
import { Link } from "@/components/common/link";
import { Note } from "@/components/common/note";
import {
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { Section } from "@/components/content/section";
import { useTRPC } from "@/lib/trpc/client";

const messageKeys = [1, 2, 3, 4] as const;

export default function Page() {
  const t = useTranslations("agents");
  const trpc = useTRPC();
  const { data: workspace } = useQuery(trpc.workspace.get.queryOptions());
  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>{t("title")}</SectionTitle>
          <SectionDescription>
            {t("description")}{" "}
            <Link
              href="https://www.openstatus.dev/blog/openstatus-slack-agent"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("readMore")}
            </Link>
            .
          </SectionDescription>
        </SectionHeader>
        {!workspace?.limits["slack-agent"] ? (
          <Note color="info" size="sm">
            <Info />
            {t("paidNote")}
          </Note>
        ) : null}
        <Button size="sm" asChild>
          <Link href="/settings/integrations">{t("install")}</Link>
        </Button>
      </Section>
      <Section>
        <SectionHeader>
          <SectionTitle>{t("messagesTitle")}</SectionTitle>
          <SectionDescription>
            {t("messagesDescription")}
          </SectionDescription>
        </SectionHeader>
        <Note size="sm">
          <Info />
          {t("mentionHint")}
        </Note>
        <ul className="flex flex-col gap-2">
          {messageKeys.map((messageKey) => (
            <li key={messageKey} className="flex flex-col gap-0.5">
              <p className="text-muted-foreground text-xs">
                {t(`example${messageKey}Description`)}
              </p>
              <Code>{t(`example${messageKey}Message`)}</Code>
            </li>
          ))}
        </ul>
      </Section>
    </SectionGroup>
  );
}
