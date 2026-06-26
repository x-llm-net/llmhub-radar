/** @jsxImportSource react */

import {
  Body,
  Column,
  Head,
  Heading,
  Html,
  Link,
  Markdown,
  Preview,
  Row,
  Section,
  Text,
} from "react-email";
import { z } from "zod";

import { Layout } from "./_components/layout";
import { colors, styles } from "./_components/styles";
import { normalizeEmailLocale } from "../src/locale";

export const StatusReportSchema = z.object({
  pageTitle: z.string(),
  // statusReportStatus from db
  status: z.enum([
    "investigating",
    "identified",
    "monitoring",
    "resolved",
    "maintenance",
  ]),
  date: z.string(),
  message: z.string(),
  reportTitle: z.string(),
  pageComponents: z.array(z.string()),
  unsubscribeUrl: z.url(),
  manageUrl: z.url(),
  locale: z.string().optional(),
});

export type StatusReportProps = z.infer<typeof StatusReportSchema>;

function getStatusColor(status: string) {
  switch (status) {
    case "investigating":
      return colors.danger;
    case "identified":
      return colors.warning;
    case "resolved":
      return colors.success;
    case "monitoring":
      return colors.info;
    case "maintenance":
      return colors.info;
    default:
      return colors.success;
  }
}

function getCopy(locale?: string | null) {
  if (normalizeEmailLocale(locale) === "zh") {
    return {
      preview: (pageTitle: string) => `「${pageTitle}」状态页有新更新`,
      labels: {
        title: "标题",
        date: "时间",
        affected: "影响范围",
        unavailable: "无",
        unsubscribe: "取消订阅",
        manage: "管理通知",
      },
      status: {
        investigating: "调查中",
        identified: "已定位",
        monitoring: "监控中",
        resolved: "已恢复",
        maintenance: "维护",
      },
      maintenanceSubject: (title: string) => `计划维护：${title}`,
    };
  }

  return {
    preview: (pageTitle: string) => `There are new updates on "${pageTitle}"`,
    labels: {
      title: "Title",
      date: "Date",
      affected: "Affected",
      unavailable: "N/A",
      unsubscribe: "Unsubscribe",
      manage: "Manage notifications",
    },
    status: {
      investigating: "Investigating",
      identified: "Identified",
      monitoring: "Monitoring",
      resolved: "Resolved",
      maintenance: "Maintenance",
    },
    maintenanceSubject: (title: string) => `Scheduled Maintenance: ${title}`,
  };
}

export function getMaintenanceNotificationSubject({
  locale,
  title,
}: {
  locale?: string | null;
  title: string;
}) {
  return getCopy(locale).maintenanceSubject(title);
}

function StatusReportEmail({
  status,
  date,
  message,
  reportTitle,
  pageTitle,
  pageComponents,
  unsubscribeUrl,
  manageUrl,
  locale,
}: StatusReportProps) {
  const copy = getCopy(locale);

  return (
    <Html>
      <Head />
      <Preview>{copy.preview(pageTitle)}</Preview>
      <Body style={styles.main}>
        <Layout>
          <Row>
            <Column>
              <Heading as="h3">{pageTitle}</Heading>
            </Column>
            <Column style={{ textAlign: "right" }}>
              <Text
                style={{
                  color: getStatusColor(status),
                  textTransform: "uppercase",
                }}
              >
                {copy.status[status]}
              </Text>
            </Column>
          </Row>
          <Row style={styles.row}>
            <Column>
              <Text style={styles.bold}>{copy.labels.title}</Text>
            </Column>
            <Column style={{ textAlign: "right" }}>
              <Text>{reportTitle}</Text>
            </Column>
          </Row>
          <Row style={styles.row}>
            <Column>
              <Text style={styles.bold}>{copy.labels.date}</Text>
            </Column>
            <Column style={{ textAlign: "right" }}>
              <Text>{date}</Text>
            </Column>
          </Row>
          <Row style={styles.row}>
            <Column>
              <Text style={styles.bold}>{copy.labels.affected}</Text>
            </Column>
            <Column style={{ textAlign: "right" }}>
              <Text style={{ flexWrap: "wrap", wordWrap: "break-word" }}>
                {pageComponents.length > 0
                  ? pageComponents.join(", ")
                  : copy.labels.unavailable}
              </Text>
            </Column>
          </Row>
          <Row style={styles.row}>
            <Column>
              <Markdown>{message}</Markdown>
            </Column>
          </Row>
          {unsubscribeUrl && (
            <Section style={{ marginTop: "24px", textAlign: "center" }}>
              <Text style={{ fontSize: "12px", color: "#6b7280" }}>
                <Link
                  href={unsubscribeUrl}
                  style={{ color: "#6b7280", textDecoration: "underline" }}
                >
                  {copy.labels.unsubscribe}
                </Link>{" "}
                ・{" "}
                <Link
                  href={manageUrl}
                  style={{ color: "#6b7280", textDecoration: "underline" }}
                >
                  {copy.labels.manage}
                </Link>
              </Text>
            </Section>
          )}
        </Layout>
      </Body>
    </Html>
  );
}

StatusReportEmail.PreviewProps = {
  pageTitle: "OpenStatus Status",
  reportTitle: "API Unavaible",
  status: "investigating",
  date: new Date().toISOString(),
  message: `
**Status**: Partial Service Restored

**GitHub Runners**: Operational

**Cache Action**: Degraded

---

### What's Changed

- All queued workflows are now being picked up and completed successfully.
- Jobs are running normally on our GitHub App. ### Current Issue: Cache Action Unavailable Attempts to re-publish our action to GitHub Marketplace are returning 500 Internal Server Errors. This prevents the updated versions from going live.

### Mitigation In Progress

- Collaborating with GitHub Support to resolve any upstream issues.

### Next Update

We'll post another update by **19:00 UTC** today or sooner if critical developments occur. We apologize for the inconvenience and appreciate your patience as we restore full cache functionality.
  `,
  pageComponents: ["OpenStatus API", "OpenStatus Webhook"],
  unsubscribeUrl:
    "https://status.openstatus.dev/unsubscribe/550e8400-e29b-41d4-a716-446655440000",
  manageUrl:
    "https://status.openstatus.dev/manage/550e8400-e29b-41d4-a716-446655440000",
  locale: "en",
};

export default StatusReportEmail;
