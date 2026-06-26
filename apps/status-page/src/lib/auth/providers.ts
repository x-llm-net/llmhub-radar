import { EmailClient } from "@openstatus/emails";
import Resend from "next-auth/providers/resend";

import { getQueryClient, trpc } from "@/lib/trpc/server";

import { getValidCustomDomain } from "../domain";

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

export const ResendProvider = Resend({
  apiKey: undefined,
  async sendVerificationRequest(params) {
    const url = params.url;
    const email = params.identifier;

    const emailClient = new EmailClient({
      apiKey: process.env.RESEND_API_KEY ?? "",
    });

    const { prefix } = getValidCustomDomain(params.request);

    if (!prefix) return;

    const queryClient = getQueryClient();
    const query = await queryClient.fetchQuery(
      trpc.statusPage.validateEmailDomain.queryOptions({ slug: prefix, email }),
    );

    if (!query) return;

    await emailClient.sendStatusPageMagicLink({
      page: query.page.title,
      link: url,
      to: params.identifier,
      locale: getLocaleFromAuthUrl(url),
    });
  },
});
