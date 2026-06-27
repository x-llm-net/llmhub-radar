import { redirect } from "next/navigation";

import { getQueryClient, trpc } from "@/lib/trpc/server";

export default async function LegacyManageRedirect({
  params,
}: {
  params: Promise<{ domain: string; token: string }>;
}) {
  const { domain, token } = await params;
  const queryClient = getQueryClient();
  const page = await queryClient.fetchQuery(
    trpc.statusPage.get.queryOptions({ slug: domain }),
  );

  const locale = page?.defaultLocale ?? "en";
  redirect(`/${domain}/${locale}/manage/${token}`);
}
