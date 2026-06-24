import { Badge } from "@openstatus/ui/components/ui/badge";
import { Button } from "@openstatus/ui/components/ui/button";
import { useTranslations } from "next-intl";

import {
  Section,
  SectionDescription,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";

type Props = {
  onSelect: (text: string) => void;
};

export function ChatSuggestions({ onSelect }: Props) {
  const t = useTranslations("chat.suggestions");
  const suggestions = [
    t("listMonitors"),
    t("unresolvedReports"),
    t("draftReport"),
    t("scheduleMaintenance"),
  ];

  return (
    <Section className="flex w-full max-w-3xl flex-col items-center">
      <SectionHeader className="max-w-2xl text-center">
        <SectionTitle>{t("title")}</SectionTitle>
        <SectionDescription>
          {t("description")}{" "}
          <span className="text-muted-foreground/80">
            {t("feedback")}
          </span>{" "}
          <Badge variant="secondary" className="bg-info/10 text-info">
            {t("beta")}
          </Badge>
        </SectionDescription>
      </SectionHeader>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {suggestions.map((s) => (
          <Button
            key={s}
            variant="outline"
            size="sm"
            className="rounded-full px-4"
            onClick={() => onSelect(s)}
          >
            {s}
          </Button>
        ))}
      </div>
    </Section>
  );
}
