/** @jsxImportSource react */

import { Body, Head, Heading, Html, Link, Preview, Text } from "react-email";

import { Layout } from "./_components/layout";
import { styles } from "./_components/styles";
import { normalizeEmailLocale } from "../src/locale";

export interface StatusPageMagicLinkProps {
  page: string;
  link: string;
  locale?: string;
}

function getCopy(locale?: string | null) {
  if (normalizeEmailLocale(locale) === "zh") {
    return {
      title: (page: string) => `访问「${page}」状态页`,
      preview: (page: string) => `访问「${page}」状态页`,
      heading: (page: string) => `访问「${page}」状态页`,
      intro: (page: string) =>
        `你收到这封邮件，是因为你请求访问「${page}」状态页。`,
      help: "点击下方链接完成验证。链接 24 小时内有效。如果这不是你的操作，可以忽略这封邮件。",
      button: "验证访问",
      subject: (page: string) => `访问 ${page} 状态页`,
    };
  }

  return {
    title: (page: string) => `Access "${page}" Status Page`,
    preview: (page: string) => `Access "${page}" Status Page`,
    heading: (page: string) => `Access "${page}" Status Page`,
    intro: (page: string) =>
      `You are receiving this email because you requested access to "${page}".`,
    help: "Click the link below to authenticate. The link is valid for 24 hours. If you believe this is a mistake, please ignore this email.",
    button: "Authenticate",
    subject: (page: string) => `Access ${page}`,
  };
}

export function getStatusPageMagicLinkSubject({
  page,
  locale,
}: Pick<StatusPageMagicLinkProps, "page" | "locale">) {
  return getCopy(locale).subject(page);
}

const StatusPageMagicLinkEmail = ({
  page,
  link,
  locale,
}: StatusPageMagicLinkProps) => {
  const copy = getCopy(locale);

  return (
    <Html>
      <Head>
        <title>{copy.title(page)}</title>
      </Head>
      <Preview>{copy.preview(page)}</Preview>
      <Body>
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

StatusPageMagicLinkEmail.PreviewProps = {
  page: "OpenStatus",
  link: "https://slug.openstatus.dev/verify/token-xyz",
} satisfies StatusPageMagicLinkProps;

export default StatusPageMagicLinkEmail;
