"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Code } from "@/components/common/code";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center p-4 md:p-8">
      <div className="border-border bg-sidebar mx-auto w-full max-w-md rounded-lg border">
        <div className="flex flex-col gap-6 p-6 sm:p-8">
          <div className="flex flex-col gap-1 text-center">
            <p className="text-destructive font-mono">{t("serverLabel")}</p>
            <h2 className="font-cal text-foreground text-2xl">
              {t("serverTitle")}
            </h2>
            <p className="text-muted-foreground text-sm">
              {t("serverDescriptionPrefix")}{" "}
              <a
                href="mailto:ping@openstatus.dev"
                className="text-foreground underline underline-offset-4"
              >
                {t("contactUs")}
              </a>
              .
            </p>
          </div>
          {process.env.NODE_ENV === "development" && (
            <Code className="border-border bg-background text-destructive max-h-40 overflow-auto rounded-md border">
              {error.message}
              {error.stack && `\n\n${error.stack}`}
            </Code>
          )}
          <div className="flex items-center justify-center gap-4">
            <Button variant="outline" onClick={reset}>
              {t("tryAgain")}
            </Button>
            <Button asChild>
              <Link href="/overview">{t("home")}</Link>
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
