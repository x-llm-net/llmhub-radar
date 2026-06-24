"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

export default function NotFound() {
  const t = useTranslations("errors");
  const router = useRouter();

  return (
    <main className="bg-background flex min-h-screen w-full flex-col space-y-6 p-4 md:p-8">
      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        <div className="bg-card mx-auto max-w-xl rounded-lg border text-center">
          <div className="flex flex-col gap-4 p-6 sm:p-12">
            <div className="flex flex-col gap-1">
              <p className="text-foreground font-mono">{t("notFoundLabel")}</p>
              <h2 className="font-cal text-foreground text-2xl">
                {t("notFoundTitle")}
              </h2>
              <p className="text-muted-foreground text-sm sm:text-base">
                {t("notFoundDescription")}
              </p>
            </div>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button
                variant="outline"
                size="lg"
                onClick={router.back}
                className="cursor-pointer"
              >
                {t("goBack")}
              </Button>
              <Button size="lg" asChild>
                <Link href="/">{t("home")}</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
