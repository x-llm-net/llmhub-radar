/** @jsxImportSource react */

import { Body, Head, Heading, Html, Link, Preview, Text } from "react-email";
import { z } from "zod";

import { Layout } from "./_components/layout";
import { styles } from "./_components/styles";
import { normalizeEmailLocale } from "../src/locale";

const BASE_URL = "https://llm-hub.store/invite";

export const TeamInvitationSchema = z.object({
  invitedBy: z.string(),
  workspaceName: z.string().optional().nullable(),
  token: z.string(),
  baseUrl: z.string().optional(),
  locale: z.string().optional(),
});

export type TeamInvitationProps = z.infer<typeof TeamInvitationSchema>;

function getCopy(locale?: string | null) {
  if (normalizeEmailLocale(locale) === "zh") {
    return {
      preview: "你已被邀请加入 LLMHub Radar",
      defaultWorkspace: "我的空间",
      heading: (workspaceName: string, invitedBy: string) =>
        `${invitedBy} 邀请你加入「${workspaceName}」团队空间`,
      intro: "点击下方链接即可进入团队空间。",
      link: "接受邀请",
      note: "如果你还没有账号，需要先登录或创建账号。",
      subject: (workspaceName: string) => `邀请你加入 ${workspaceName}`,
    };
  }

  return {
    preview: "You have been invited to join LLMHub Radar",
    defaultWorkspace: "My space",
    heading: (workspaceName: string, invitedBy: string) =>
      `${invitedBy} invited you to join "${workspaceName}"`,
    intro: "Click the link below to access the team space.",
    link: "Accept invitation",
    note: "If you do not have an account yet, you will need to sign in or create one.",
    subject: (workspaceName: string) =>
      `You've been invited to join ${workspaceName}`,
  };
}

export function getTeamInvitationSubject({
  locale,
  workspaceName,
}: Pick<TeamInvitationProps, "locale" | "workspaceName">) {
  const copy = getCopy(locale);
  return copy.subject(workspaceName || copy.defaultWorkspace);
}

const TeamInvitationEmail = ({
  token,
  workspaceName,
  invitedBy,
  baseUrl = BASE_URL,
  locale,
}: TeamInvitationProps) => {
  const copy = getCopy(locale);
  const displayWorkspaceName = workspaceName || copy.defaultWorkspace;

  return (
    <Html>
      <Head />
      <Preview>{copy.preview}</Preview>
      <Body style={styles.main}>
        <Layout>
          <Heading as="h3">
            {copy.heading(displayWorkspaceName, invitedBy)}
          </Heading>
          <Text>
            <Link style={styles.link} href={`${baseUrl}?token=${token}`}>
              {copy.link}
            </Link>
          </Text>
          <Text>{copy.intro}</Text>
          <Text>{copy.note}</Text>
        </Layout>
      </Body>
    </Html>
  );
};

TeamInvitationEmail.PreviewProps = {
  token: "token",
  workspaceName: "LLMHub Radar",
  invitedBy: "support@llm-hub.store",
} satisfies TeamInvitationProps;

export default TeamInvitationEmail;
