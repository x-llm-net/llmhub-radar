import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { pickPreferredLocale } from "@/lib/locale-negotiation";
import { getQueryClient, trpc } from "@/lib/trpc/server";

function buildSearch(
  searchParams: Record<string, string | string[] | undefined>,
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
      continue;
    }
    if (typeof value === "string") params.set(key, value);
  }

  const search = params.toString();
  return search ? `?${search}` : "";
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ domain: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { domain } = await params;
  const queryClient = getQueryClient();
  const page = await queryClient.fetchQuery(
    trpc.statusPage.get.queryOptions({ slug: domain }),
  );

  if (!page) notFound();

  const headerStore = await headers();
  const locale = pickPreferredLocale({
    acceptLanguage: headerStore.get("accept-language"),
    enabledLocales: page.locales,
    fallbackLocale: page.defaultLocale,
  });

  redirect(
    `/${encodeURIComponent(domain)}/${locale}${buildSearch(await searchParams)}`,
  );
}
