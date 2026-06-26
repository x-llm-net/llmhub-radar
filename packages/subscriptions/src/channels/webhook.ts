import { COLORS, COLOR_DECIMALS } from "@openstatus/notification-base";
import { assertSafeUrl } from "@openstatus/utils";
import { z } from "zod";

import { getPublicStatusPageUrl } from "../status-page-url";
import type { PageUpdate, Subscription } from "../types";

export type WebhookFlavor = "slack" | "discord" | "wecom" | "generic";

const SLACK_PREFIX = "https://hooks.slack.com/services/";
const DISCORD_PREFIX = "https://discord.com/api/webhooks/";
const WECOM_ORIGIN = "https://qyapi.weixin.qq.com";

/**
 * Classify a webhook URL by its incoming-webhook origin so we can emit
 * channel-native payloads. Unknown URLs fall back to generic JSON.
 */
export function detectWebhookFlavor(url: string): WebhookFlavor {
  if (url.startsWith(SLACK_PREFIX)) return "slack";
  if (url.startsWith(DISCORD_PREFIX)) return "discord";
  if (url.startsWith(`${WECOM_ORIGIN}/cgi-bin/webhook/send`)) return "wecom";
  return "generic";
}

function redactWebhookUrl(url: string): string {
  try {
    return `${new URL(url).origin}/***`;
  } catch {
    return "<invalid-url>";
  }
}

function resolveStatusPageOrigin(subscription: Subscription): string {
  return getPublicStatusPageUrl({
    customDomain: subscription.customDomain,
    slug: subscription.pageSlug,
  });
}

function buildManagementLinks(subscription: Subscription) {
  if (!subscription.token) {
    return { manageUrl: null, unsubscribeUrl: null };
  }
  const origin = resolveStatusPageOrigin(subscription);
  return {
    manageUrl: `${origin}/manage/${subscription.token}`,
    unsubscribeUrl: `${origin}/unsubscribe/${subscription.token}`,
  };
}

type StatusColor = "red" | "yellow" | "green" | "blue";

function statusColor(status: PageUpdate["status"]): StatusColor {
  switch (status) {
    case "investigating":
    case "identified":
      return "red";
    case "monitoring":
      return "yellow";
    case "resolved":
      return "green";
    case "maintenance":
      return "blue";
  }
}

function statusLabel(status: PageUpdate["status"]) {
  switch (status) {
    case "investigating":
      return "Investigating";
    case "identified":
      return "Identified";
    case "monitoring":
      return "Monitoring";
    case "resolved":
      return "Resolved";
    case "maintenance":
      return "Maintenance";
  }
}

function wecomStatusColor(status: PageUpdate["status"]) {
  switch (status) {
    case "resolved":
      return "info";
    case "maintenance":
    case "monitoring":
      return "comment";
    case "investigating":
    case "identified":
      return "warning";
  }
}

export async function validateWebhookConfig(config: unknown) {
  const schema = z.object({
    headers: z
      .array(
        z.object({
          key: z.string().min(1),
          value: z.string(),
        }),
      )
      .optional(),
    secret: z.string().optional(),
  });
  const result = schema.safeParse(config);
  return { valid: result.success, error: result.error?.message };
}

function hasWebhookUrl(
  sub: Subscription,
): sub is Subscription & { webhookUrl: string } {
  return sub.webhookUrl !== undefined && sub.webhookUrl !== null;
}

export async function sendWebhookVerification(
  subscription: Subscription,
  verifyUrl: string,
) {
  if (!subscription.webhookUrl) {
    throw new Error("Webhook URL is required for webhook channel");
  }

  const flavor = detectWebhookFlavor(subscription.webhookUrl);
  await assertSafeUrl(subscription.webhookUrl);
  const response = await fetch(subscription.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      buildVerificationPayload(flavor, subscription, verifyUrl),
    ),
    signal: AbortSignal.timeout(10000),
  });

  await assertWebhookResponse(response, flavor, "Webhook verification failed");
}

function buildVerificationPayload(
  flavor: WebhookFlavor,
  subscription: Subscription,
  verifyUrl: string,
) {
  switch (flavor) {
    case "slack":
      return {
        text: `Verify ${subscription.pageName} status updates: ${verifyUrl}`,
      };
    case "discord":
      return {
        content: `Verify ${subscription.pageName} status updates: ${verifyUrl}`,
      };
    case "wecom":
      return {
        msgtype: "markdown",
        markdown: {
          content: [
            `**${subscription.pageName} 服务状态订阅验证**`,
            `> 验证链接：${verifyUrl}`,
            "> 如果你看到了这条消息，说明 Webhook 可以接收 LLMHub Radar 的状态更新。",
          ].join("\n"),
        },
      };
    case "generic":
      return {
        type: "verification",
        token: subscription.token,
        verifyUrl,
      };
  }
}

async function assertWebhookResponse(
  response: Response,
  flavor: WebhookFlavor,
  message: string,
) {
  if (!response.ok) {
    throw new Error(`${message}: ${response.status} ${response.statusText}`);
  }

  if (flavor !== "wecom") return;

  const bodyText = await response.text();
  if (!bodyText) return;

  try {
    const body = JSON.parse(bodyText) as { errcode?: number; errmsg?: string };
    if (typeof body.errcode === "number" && body.errcode !== 0) {
      throw new Error(`${message}: ${body.errcode} ${body.errmsg ?? ""}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(message)) {
      throw error;
    }
  }
}

type ManagementLinks = ReturnType<typeof buildManagementLinks>;

function buildSlackPayload(
  pageUpdate: PageUpdate,
  subscription: Subscription,
  links: ManagementLinks,
) {
  const color = statusColor(pageUpdate.status);

  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: pageUpdate.title,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Status*\n${pageUpdate.status}`,
        },
        {
          type: "mrkdwn",
          text: `*Page*\n${subscription.pageName}`,
        },
      ],
    },
  ];

  if (pageUpdate.message) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: pageUpdate.message,
      },
    });
  }

  if (pageUpdate.pageComponents.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Affected*\n${pageUpdate.pageComponents.join(", ")}`,
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: pageUpdate.date,
      },
    ],
  });

  if (links.manageUrl && links.unsubscribeUrl) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `<${links.manageUrl}|Manage> · <${links.unsubscribeUrl}|Unsubscribe>`,
        },
      ],
    });
  }

  return {
    attachments: [
      {
        color: COLORS[color],
        blocks,
      },
    ],
  };
}

function buildDiscordPayload(
  pageUpdate: PageUpdate,
  subscription: Subscription,
  links: ManagementLinks,
) {
  const color = statusColor(pageUpdate.status);

  const descriptionParts: string[] = [];
  if (pageUpdate.message) descriptionParts.push(pageUpdate.message);
  if (pageUpdate.pageComponents.length > 0) {
    descriptionParts.push(
      `**Affected:** ${pageUpdate.pageComponents.join(", ")}`,
    );
  }
  if (links.manageUrl && links.unsubscribeUrl) {
    descriptionParts.push(
      `[Manage](${links.manageUrl}) · [Unsubscribe](${links.unsubscribeUrl})`,
    );
  }

  return {
    embeds: [
      {
        title: pageUpdate.title,
        description: descriptionParts.join("\n\n") || undefined,
        color: COLOR_DECIMALS[color],
        fields: [
          {
            name: "Status",
            value: pageUpdate.status,
            inline: true,
          },
          {
            name: "Page",
            value: subscription.pageName,
            inline: true,
          },
        ],
        footer: {
          text: pageUpdate.date,
        },
      },
    ],
  };
}

function buildWeComPayload(
  pageUpdate: PageUpdate,
  subscription: Subscription,
  links: ManagementLinks,
) {
  const components =
    pageUpdate.pageComponents.length > 0
      ? pageUpdate.pageComponents.join(", ")
      : "All components";
  const lines = [
    `**${pageUpdate.title}**`,
    `> 页面：${subscription.pageName}`,
    `> 状态：<font color="${wecomStatusColor(pageUpdate.status)}">${statusLabel(pageUpdate.status)}</font>`,
    `> 影响范围：${components}`,
    `> 时间：${pageUpdate.date}`,
  ];

  if (pageUpdate.message) {
    lines.push("", pageUpdate.message);
  }

  if (links.manageUrl && links.unsubscribeUrl) {
    lines.push(
      "",
      `[管理订阅](${links.manageUrl}) | [退订](${links.unsubscribeUrl})`,
    );
  }

  return {
    msgtype: "markdown",
    markdown: {
      content: lines.join("\n"),
    },
  };
}

/**
 * Prepared (staged) generic webhook payload. Currently unreachable in
 * production — the input gate rejects non-Slack/Discord URLs, and the
 * dispatcher filters the same at send-time. Exported for unit-test coverage
 * so the contract stays green while generic webhooks are held back.
 */
export function buildGenericPayload(
  pageUpdate: PageUpdate,
  subscription: Subscription,
  links: ManagementLinks,
) {
  const page = {
    id: subscription.pageId,
    name: subscription.pageName,
    slug: subscription.pageSlug,
  };
  const components =
    pageUpdate.pageComponentsWithId ??
    pageUpdate.pageComponents.map((name, i) => ({ id: i, name }));
  const subscriptionBlock = {
    manage_url: links.manageUrl,
    unsubscribe_url: links.unsubscribeUrl,
  };

  if (pageUpdate.status === "maintenance") {
    return {
      type: "maintenance" as const,
      data: {
        maintenance: {
          id: pageUpdate.id,
          title: pageUpdate.title,
          message: pageUpdate.message,
          starts_at: pageUpdate.startsAt,
          ends_at: pageUpdate.endsAt,
          page,
          components,
        },
      },
      subscription: subscriptionBlock,
    };
  }

  return {
    type: "status_report" as const,
    data: {
      status_report: {
        id: pageUpdate.id,
        title: pageUpdate.title,
        update: {
          id: pageUpdate.updateId,
          status: pageUpdate.status,
          message: pageUpdate.message,
          created_at: pageUpdate.date,
        },
        page,
        components,
      },
    },
    subscription: subscriptionBlock,
  };
}

function buildNotificationPayload(
  pageUpdate: PageUpdate,
  subscription: Subscription,
) {
  if (!hasWebhookUrl(subscription)) {
    throw new Error("Subscription has no webhook URL");
  }
  const flavor = detectWebhookFlavor(subscription.webhookUrl);
  const links = buildManagementLinks(subscription);

  switch (flavor) {
    case "slack":
      return buildSlackPayload(pageUpdate, subscription, links);
    case "discord":
      return buildDiscordPayload(pageUpdate, subscription, links);
    case "wecom":
      return buildWeComPayload(pageUpdate, subscription, links);
    case "generic":
      return buildGenericPayload(pageUpdate, subscription, links);
  }
}

export async function sendWebhookNotifications(
  subscriptions: Subscription[],
  pageUpdate: PageUpdate,
) {
  const validSubscriptions = subscriptions.filter(hasWebhookUrl);
  if (validSubscriptions.length === 0) return;

  await Promise.allSettled(
    validSubscriptions.map(async (subscription) => {
      let config: Record<string, unknown> = {};
      try {
        config = subscription.channelConfig
          ? JSON.parse(subscription.channelConfig)
          : {};
      } catch {
        console.error(
          `Invalid channelConfig JSON for subscription ${subscription.id}`,
        );
      }

      const flavor = detectWebhookFlavor(subscription.webhookUrl);
      const payload = buildNotificationPayload(pageUpdate, subscription);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "OpenStatus-Webhooks/1.0",
      };

      if (config.headers) {
        for (const header of config.headers as {
          key: string;
          value: string;
        }[]) {
          headers[header.key] = header.value;
        }
      }

      try {
        await assertSafeUrl(subscription.webhookUrl);
        const response = await fetch(subscription.webhookUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });

        await assertWebhookResponse(
          response,
          flavor,
          `Webhook notification failed for ${redactWebhookUrl(subscription.webhookUrl)}`,
        );
      } catch (error) {
        console.error(
          `Failed to send webhook notification to ${redactWebhookUrl(subscription.webhookUrl)}:`,
          error,
        );
        throw error;
      }
    }),
  );
}

/**
 * Build a flavor-specific test payload (used by the "Send test" row action).
 * Exported for unit-test coverage; also called by `sendTestWebhookRequest`.
 */
export function buildTestPayload(flavor: WebhookFlavor) {
  switch (flavor) {
    case "slack":
      return {
        attachments: [
          {
            color: COLORS.green,
            blocks: [
              {
                type: "header",
                text: {
                  type: "plain_text",
                  text: "Test Notification",
                  emoji: false,
                },
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: "Your openstatus webhook is configured correctly.",
                },
              },
            ],
          },
        ],
      };
    case "discord":
      return {
        embeds: [
          {
            title: "Test Notification",
            description: "Your openstatus webhook is configured correctly.",
            color: COLOR_DECIMALS.green,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    case "wecom":
      return {
        msgtype: "markdown",
        markdown: {
          content:
            "**Test Notification**\n> Your LLMHub Radar webhook is configured correctly.",
        },
      };
    case "generic":
      return {
        type: "test",
        message: "Your openstatus webhook is configured correctly.",
        timestamp: new Date().toISOString(),
      };
  }
}

/**
 * Send a test payload to the given webhook URL. SSRF-checked and timeout-capped.
 * Throws on non-2xx or network error.
 */
export async function sendTestWebhookRequest(input: {
  url: string;
  flavor: WebhookFlavor;
  headers?: Record<string, string>;
}) {
  const { url, flavor, headers: extraHeaders = {} } = input;
  await assertSafeUrl(url);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "OpenStatus-Webhooks/1.0",
    ...extraHeaders,
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(buildTestPayload(flavor)),
    signal: AbortSignal.timeout(10000),
  });

  await assertWebhookResponse(response, flavor, "Test webhook failed");
}
