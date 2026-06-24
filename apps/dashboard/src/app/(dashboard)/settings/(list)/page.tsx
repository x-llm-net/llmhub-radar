import { Link } from "@/components/common/link";
import {
  ActionCard,
  ActionCardDescription,
  ActionCardGroup,
  ActionCardHeader,
  ActionCardTitle,
} from "@/components/content/action-card";
import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { getTranslations } from "next-intl/server";

export default async function Page() {
  const t = await getTranslations("settings.index");
  const settings = [
    {
      title: t("general"),
      description: t("generalDescription"),
      href: "/settings/general",
    },
    {
      title: t("billing"),
      description: t("billingDescription"),
      href: "/settings/billing",
    },
    {
      title: t("account"),
      description: t("accountDescription"),
      href: "/settings/account",
    },
    {
      title: t("integrations"),
      description: t("integrationsDescription"),
      href: "/settings/integrations",
    },
  ];

  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>{t("title")}</SectionTitle>
          <SectionDescription>
            {t("description")}
          </SectionDescription>
        </SectionHeader>
        <ActionCardGroup>
          {settings.map((setting) => (
            <Link href={setting.href} key={setting.href}>
              <ActionCard className="h-full w-full">
                <ActionCardHeader>
                  <ActionCardTitle>{setting.title}</ActionCardTitle>
                  <ActionCardDescription>
                    {setting.description}
                  </ActionCardDescription>
                </ActionCardHeader>
              </ActionCard>
            </Link>
          ))}
        </ActionCardGroup>
      </Section>
    </SectionGroup>
  );
}
