/** @jsxImportSource react */

import { Body, Head, Heading, Html, Link, Preview, Text } from "react-email";
import { z } from "zod";

import { Layout } from "./_components/layout";
import { styles } from "./_components/styles";
import { normalizeEmailLocale } from "../src/locale";

export const PageSubscriptionSchema = z.object({
  page: z.string(),
  link: z.string(),
  locale: z.string().optional(),
  img: z
    .object({
      src: z.string(),
      alt: z.string(),
      href: z.string(),
    })
    .optional(),
});

export type PageSubscriptionProps = z.infer<typeof PageSubscriptionSchema>;

function getCopy(locale?: string | null) {
  if (normalizeEmailLocale(locale) === "zh") {
    return {
      preview: (page: string) => `确认订阅「${page}」状态页`,
      heading: (page: string) => `确认订阅「${page}」状态页`,
      intro: (page: string) =>
        `你收到这封邮件，是因为你订阅了「${page}」状态页的更新。`,
      help: "点击下方链接确认订阅。链接 7 天内有效。如果这不是你的操作，可以忽略这封邮件。",
      button: "确认订阅",
      subject: (page: string) => `确认订阅 ${page}`,
    };
  }

  return {
    preview: (page: string) => `Confirm your subscription to "${page}"`,
    heading: (page: string) => `Confirm your subscription to "${page}"`,
    intro: (page: string) =>
      `You are receiving this email because you subscribed to updates from "${page}".`,
    help: "Click the link below to confirm your subscription. The link is valid for 7 days. If you believe this is a mistake, please ignore this email.",
    button: "Confirm subscription",
    subject: (page: string) => `Confirm your subscription to ${page}`,
  };
}

export function getPageSubscriptionSubject({
  page,
  locale,
}: Pick<PageSubscriptionProps, "page" | "locale">) {
  return getCopy(locale).subject(page);
}

const PageSubscriptionEmail = ({
  page,
  link,
  locale,
  img,
}: PageSubscriptionProps) => {
  const copy = getCopy(locale);

  return (
    <Html>
      <Head />
      <Preview>{copy.preview(page)}</Preview>
      <Body style={styles.main}>
        <Layout img={img}>
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

PageSubscriptionEmail.PreviewProps = {
  link: "https://slug.openstatus.dev/verify/token",
  page: "OpenStatus",
} satisfies PageSubscriptionProps;

export default PageSubscriptionEmail;
