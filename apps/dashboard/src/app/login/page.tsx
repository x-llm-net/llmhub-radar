import { GitHubIcon } from "@openstatus/icons";
import { GoogleIcon } from "@openstatus/icons";
import { Separator } from "@openstatus/ui/components/ui/separator";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { SearchParams } from "nuqs/server";

import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { signIn } from "@/lib/auth";

import { LoginButton } from "./_components/login-button";
import MagicLinkForm from "./_components/magic-link-form";
import { searchParamsCache } from "./search-params";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");

  return {
    title: t("signInTitle"),
    description: t("signInDescription"),
    robots: {
      index: true,
      follow: true,
    },
    alternates: {
      canonical: "https://app.openstatus.dev/login",
    },
  };
}

export default async function Page(props: {
  searchParams: Promise<SearchParams>;
}) {
  const searchParams = await props.searchParams;
  const { redirectTo } = searchParamsCache.parse(searchParams);
  const t = await getTranslations("auth");
  const isInviteFlow = redirectTo?.startsWith("/invite") ?? false;
  const oauthConfigured = {
    github: Boolean(
      process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET,
    ),
    google: Boolean(
      process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
    ),
  };

  return (
    <div className="my-16 grid w-full max-w-lg gap-6">
      <div className="flex justify-end px-4">
        <LanguageSwitcher />
      </div>
      <div className="flex flex-col gap-1 text-center">
        <h1 className="font-cal text-3xl tracking-tight">{t("signInTitle")}</h1>
        <p className="font-commit-mono text-muted-foreground text-sm text-pretty">
          {t("signInDescription")}
        </p>
        {isInviteFlow ? (
          <p className="font-commit-mono text-muted-foreground text-sm text-pretty">
            {t("inviteSignInHint")}
          </p>
        ) : null}
      </div>
      <div className="grid gap-4 p-4">
        <div className="grid gap-4">
          <MagicLinkForm redirectTo={redirectTo ?? undefined} />
          <Separator />
        </div>
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: redirectTo ?? undefined });
          }}
          className="w-full"
        >
          <LoginButton
            type="submit"
            provider="github"
            disabled={!oauthConfigured.github}
          >
            {oauthConfigured.github
              ? t("signInGithub")
              : t("signInGithubSetup")}{" "}
            <GitHubIcon className="ml-2 h-4 w-4" />
          </LoginButton>
        </form>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: redirectTo ?? undefined });
          }}
          className="w-full"
        >
          <LoginButton
            type="submit"
            provider="google"
            disabled={!oauthConfigured.google}
          >
            {oauthConfigured.google
              ? t("signInGoogle")
              : t("signInGoogleSetup")}{" "}
            <GoogleIcon className="ml-2 h-4 w-4" />
          </LoginButton>
        </form>
      </div>
      <p className="text-muted-foreground mx-auto max-w-md px-8 text-center text-xs text-pretty">
        {t("footerTrust")}{" "}
        <Link
          href="https://github.com/x-llm-net/llmhub-radar"
          target="_blank"
          rel="noreferrer"
          className="hover:text-primary underline underline-offset-4 hover:no-underline"
        >
          {t("footerGithub")}
        </Link>
        .
      </p>
    </div>
  );
}
