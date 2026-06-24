import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AuthLayout } from "@/components/layout/auth-layout";
import { auth } from "@/lib/auth";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (session) redirect("/");
  const t = await getTranslations("auth");

  return (
    <AuthLayout
      labels={{
        docs: t("docs"),
        heroTitle: t("heroTitle"),
        heroDescription: t("heroDescription"),
        migrationPrefix: t("migrationPrefix"),
        migrationFirstSeparator: t("migrationFirstSeparator"),
        migrationLastSeparator: t("migrationLastSeparator"),
        migrationSuffix: t("migrationSuffix"),
      }}
    >
      {children}
    </AuthLayout>
  );
}
