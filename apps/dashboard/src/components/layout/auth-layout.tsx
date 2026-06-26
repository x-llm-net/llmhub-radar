import { Button } from "@openstatus/ui/components/ui/button";
import {
  Activity,
  Bell,
  BookOpen,
  FileChartColumn,
  ShieldCheck,
} from "lucide-react";

import {
  SHELL_CONTENT_COLUMN,
  SHELL_FORM_COLUMN,
} from "@/components/layout/shell-columns";
import { Wordmark } from "@/components/layout/wordmark";
import { cn } from "@/lib/utils";

type AuthLayoutProps = {
  children: React.ReactNode;
  labels: {
    docs: string;
    heroTitle: string;
    heroDescription: string;
    featureAvailability: string;
    featureStatusPages: string;
    featureNotifications: string;
    trustTitle: string;
    trustDescription: string;
  };
};

export function AuthLayout({ children, labels }: AuthLayoutProps) {
  return (
    <div className="relative grid min-h-screen grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
      <div className="absolute top-4 left-4 z-10">
        <Wordmark size={24} showText />
      </div>
      <Button
        size="sm"
        variant="outline"
        className="absolute top-4 right-4 z-10"
        asChild
      >
        <a
          href="https://github.com/x-llm-net/llmhub-radar"
          target="_blank"
          rel="noreferrer"
        >
          <BookOpen />
          {labels.docs}
        </a>
      </Button>
      {/*
        Column widths mirror onboarding: form column = `xl:col-span-2`,
        content column = `xl:col-span-3`. Both login and onboarding
        keep the form on the left, so the grids feel aligned when
        navigating between them.
      */}
      <main
        className={cn(
          "col-span-1 container mx-auto flex items-center justify-center md:col-span-1",
          SHELL_FORM_COLUMN,
        )}
      >
        {children}
      </main>
      <aside
        className={cn(
          "border-border bg-sidebar col-span-1 flex w-full flex-col gap-4 border p-4 backdrop-blur-[2px] md:p-8",
          SHELL_CONTENT_COLUMN,
        )}
      >
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 text-center md:text-left">
          <div className="mx-auto grid gap-6">
            <div className="grid gap-3">
              <h1 className="font-cal text-foreground text-3xl">
                {labels.heroTitle}
              </h1>
              <p className="font-commit-mono text-muted-foreground">
                {labels.heroDescription}
              </p>
            </div>
            <div className="grid gap-3">
              <AuthFeature icon={Activity} label={labels.featureAvailability} />
              <AuthFeature
                icon={FileChartColumn}
                label={labels.featureStatusPages}
              />
              <AuthFeature icon={Bell} label={labels.featureNotifications} />
            </div>
            <div className="border-border/70 bg-background/50 grid gap-2 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4" />
                <p className="text-sm font-medium">{labels.trustTitle}</p>
              </div>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {labels.trustDescription}
              </p>
            </div>
          </div>
        </div>
        <div className="md:h-8" />
      </aside>
    </div>
  );
}

function AuthFeature({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <div className="text-muted-foreground flex items-center gap-3 font-commit-mono text-sm">
      <span className="border-border bg-background flex size-8 shrink-0 items-center justify-center rounded-md border">
        <Icon className="size-4" />
      </span>
      <span>{label}</span>
    </div>
  );
}
