/** @jsxImportSource react */

import { Body, Head, Heading, Html, Link, Preview, Text } from "react-email";
import { z } from "zod";

import { Layout } from "./_components/layout";
import { styles } from "./_components/styles";
import { normalizeEmailLocale } from "../src/locale";

export const SubscriptionManagementLinkSchema = z.object({
  page: z.string(),
  link: z.string(),
  locale: z.string().optional(),
});

export type SubscriptionManagementLinkProps = z.infer<
  typeof SubscriptionManagementLinkSchema
>;

function getCopy(locale?: string | null) {
  if (normalizeEmailLocale(locale) === "zh") {
    return {
      preview: (page: string) => `管理「${page}」的状态订阅`,
      heading: (page: string) => `管理「${page}」的状态订阅`,
      intro: (page: string) =>
        `你收到这封邮件，是因为有人请求管理「${page}」状态页的订阅。`,
      help: "点击下方链接即可管理通知范围或取消订阅。如果这不是你的操作，可以忽略这封邮件。",
      button: "管理订阅",
      subject: (page: string) => `管理 ${page} 状态订阅`,
    };
  }

  return {
    preview: (page: string) => `Manage your subscription to "${page}"`,
    heading: (page: string) => `Manage your subscription to "${page}"`,
    intro: (page: string) =>
      `You are receiving this email because someone requested to manage a subscription to "${page}".`,
    help: "Click the link below to manage notification scope or unsubscribe. If this was not you, you can ignore this email.",
    button: "Manage subscription",
    subject: (page: string) => `Manage your ${page} subscription`,
  };
}

export function getSubscriptionManagementLinkSubject({
  page,
  locale,
}: Pick<SubscriptionManagementLinkProps, "page" | "locale">) {
  return getCopy(locale).subject(page);
}

const SubscriptionManagementLinkEmail = ({
  page,
  link,
  locale,
}: SubscriptionManagementLinkProps) => {
  const copy = getCopy(locale);

  return (
    <Html>
      <Head />
      <Preview>{copy.preview(page)}</Preview>
      <Body style={styles.main}>
        <Layout>
          <Heading as="h3">{copy.heading(page)}</Heading>
          <Text>{copy.intro(page)}</Text>
          <Text>{copy.help}</Text>
          <Text>
            <Link style={styles.link} href={link}>
              {copy.button}
            </Link>
          </Text>
        </Layout>
      </Body>
    </Html>
  );
};

SubscriptionManagementLinkEmail.PreviewProps = {
  link: "https://slug.openstatus.dev/zh/manage/token",
  page: "OpenStatus",
} satisfies SubscriptionManagementLinkProps;

export default SubscriptionManagementLinkEmail;
