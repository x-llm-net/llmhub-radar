import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";

const DEFAULT_FROM_ADDRESS = "notifications@llm-hub.store";
const DEFAULT_FROM_NAME = "LLMHub Radar";

function getAuthEmailFrom() {
  const address =
    process.env.EMAIL_FROM_ADDRESS?.trim() || DEFAULT_FROM_ADDRESS;
  const displayName = (
    process.env.EMAIL_FROM_NAME ?? DEFAULT_FROM_NAME
  ).replace(/[<>"]/g, "");

  return `${displayName || DEFAULT_FROM_NAME} <${address}>`;
}

function shouldSendAuthEmail() {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.EMAIL_SEND_IN_DEVELOPMENT === "true"
  );
}

function normalizeLocale(locale?: string | null) {
  return locale?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function getLocaleFromAuthUrl(url: string) {
  const authUrl = new URL(url);
  const directLocale = authUrl.searchParams.get("llmhub_locale");
  if (directLocale) return normalizeLocale(directLocale);

  const callbackUrl =
    authUrl.searchParams.get("callbackUrl") ??
    authUrl.searchParams.get("redirectTo");
  if (!callbackUrl) return "en";

  try {
    return normalizeLocale(new URL(callbackUrl).searchParams.get("llmhub_locale"));
  } catch {
    try {
      return normalizeLocale(
        new URL(callbackUrl, "http://localhost").searchParams.get(
          "llmhub_locale",
        ),
      );
    } catch {
      return "en";
    }
  }
}

function getMagicLinkCopy(locale: string) {
  if (normalizeLocale(locale) === "zh") {
    return {
      subject: "登录 LLMHub Radar",
      heading: "登录 LLMHub Radar",
      intro: "点击下方按钮完成登录。此链接 24 小时内有效。",
      button: "登录",
      fallback: "如果按钮无法打开，请复制以下链接到浏览器：",
      host: "请求来源",
      text: (url: string, host: string) =>
        `登录 LLMHub Radar\n\n打开此链接完成登录：\n${url}\n\n请求来源：${host}`,
    };
  }

  return {
    subject: "Sign in to LLMHub Radar",
    heading: "Sign in to LLMHub Radar",
    intro: "Click the button below to sign in. This link is valid for 24 hours.",
    button: "Sign in",
    fallback: "If the button does not work, copy and paste this link into your browser:",
    host: "Request host",
    text: (url: string, host: string) =>
      `Sign in to LLMHub Radar\n\nOpen this link to sign in:\n${url}\n\nRequest host: ${host}`,
  };
}

function getMagicLinkHtml({
  url,
  host,
  locale,
}: {
  url: string;
  host: string;
  locale: string;
}) {
  const copy = getMagicLinkCopy(locale);

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
      <h1 style="font-size: 20px; margin: 0 0 16px;">${copy.heading}</h1>
      <p>${copy.intro}</p>
      <p style="margin: 24px 0;">
        <a href="${url}" style="display: inline-block; border-radius: 6px; background: #111827; color: #ffffff; padding: 10px 16px; text-decoration: none;">
          ${copy.button}
        </a>
      </p>
      <p style="color: #6b7280; font-size: 13px;">${copy.fallback}</p>
      <p style="word-break: break-all; color: #374151; font-size: 13px;">${url}</p>
      <p style="color: #6b7280; font-size: 13px;">${copy.host}: ${host}</p>
    </div>
  `;
}

function getMagicLinkText({
  url,
  host,
  locale,
}: {
  url: string;
  host: string;
  locale: string;
}) {
  return getMagicLinkCopy(locale).text(url, host);
}

export const GitHubProvider = GitHub({
  allowDangerousEmailAccountLinking: true,
});

export const GoogleProvider = Google({
  allowDangerousEmailAccountLinking: true,
  authorization: {
    params: {
      // See https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest
      prompt: "select_account",
      // scope:
      //   "https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email",
    },
  },
});

export const ResendProvider = Resend({
  apiKey: process.env.RESEND_API_KEY,
  from: getAuthEmailFrom(),
  async sendVerificationRequest(params) {
    const { identifier: to, provider, url } = params;
    const { host } = new URL(url);
    const locale = getLocaleFromAuthUrl(url);
    const copy = getMagicLinkCopy(locale);
    const apiKey = provider.apiKey?.trim();

    if (!apiKey || !shouldSendAuthEmail()) {
      console.log("");
      console.log(`>>> LLMHub Radar Magic Link: ${url}`);
      console.log("");
      if (process.env.NODE_ENV === "production") {
        throw new Error("RESEND_API_KEY is required for email sign-in.");
      }
      return;
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: provider.from,
        to,
        subject: copy.subject,
        html: getMagicLinkHtml({ url, host, locale }),
        text: getMagicLinkText({ url, host, locale }),
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Resend error: ${JSON.stringify(await response.json())}`,
      );
    }
  },
});
