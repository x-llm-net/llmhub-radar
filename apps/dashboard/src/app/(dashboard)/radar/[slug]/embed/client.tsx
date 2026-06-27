"use client";

import { Badge } from "@openstatus/ui/components/ui/badge";
import { Button } from "@openstatus/ui/components/ui/button";
import { Checkbox } from "@openstatus/ui/components/ui/checkbox";
import { Label } from "@openstatus/ui/components/ui/label";
import { cn } from "@openstatus/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Check, Code2, Copy, ExternalLink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  EmptyStateContainer,
  EmptyStateTitle,
} from "@/components/content/empty-state";
import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { getPublicStatusHref } from "@/lib/radar-public-url";
import { useTRPC } from "@/lib/trpc/client";

type EmbedSection = "title" | "banner" | "overview" | "cards" | "criteria";
type EmbedTheme = "light" | "dark";

const SECTION_OPTIONS: EmbedSection[] = [
  "title",
  "banner",
  "overview",
  "cards",
  "criteria",
];

const DEFAULT_SECTIONS: EmbedSection[] = ["banner", "overview", "cards"];
const DEFAULT_HEIGHT = 680;

function buildEmbedUrl({
  baseUrl,
  sections,
  theme,
}: {
  baseUrl: string;
  sections: EmbedSection[];
  theme: EmbedTheme;
}) {
  const url = new URL(baseUrl);
  url.searchParams.set(
    "embed",
    sections.length > 0 ? sections.join(",") : "all",
  );
  url.searchParams.set("theme", theme);
  return url.toString();
}

function buildIframeCode({
  height,
  src,
  title,
}: {
  height: number;
  src: string;
  title: string;
}) {
  return `<iframe
  src="${src}"
  title="${title}"
  style="width:100%;height:${height}px;border:0;border-radius:12px;overflow:hidden;"
  loading="lazy"
></iframe>`;
}

export function Client() {
  const params = useParams<{ slug: string }>();
  const t = useTranslations("radar");
  const locale = useLocale();
  const trpc = useTRPC();
  const { data: pool } = useQuery(
    trpc.radar.getPool.queryOptions({ slug: params.slug }),
  );
  const [sections, setSections] = useState<EmbedSection[]>(DEFAULT_SECTIONS);
  const [theme, setTheme] = useState<EmbedTheme>("light");
  const [copied, setCopied] = useState(false);
  const publicHref = getPublicStatusHref(params.slug, locale);
  const embedUrl = useMemo(
    () => buildEmbedUrl({ baseUrl: publicHref, sections, theme }),
    [publicHref, sections, theme],
  );
  const iframeCode = useMemo(
    () =>
      buildIframeCode({
        height: DEFAULT_HEIGHT,
        src: embedUrl,
        title: `${pool?.name ?? params.slug} ${t("embedFrameTitle")}`,
      }),
    [embedUrl, params.slug, pool?.name, t],
  );

  const toggleSection = (section: EmbedSection) => {
    setSections((current) => {
      if (current.includes(section)) {
        return current.filter((item) => item !== section);
      }
      return SECTION_OPTIONS.filter((item) =>
        [...current, section].includes(item),
      );
    });
  };

  const copyCode = async () => {
    await navigator.clipboard.writeText(iframeCode);
    setCopied(true);
    toast.success(t("embedCopied"));
    window.setTimeout(() => setCopied(false), 1600);
  };

  if (!pool) {
    return (
      <SectionGroup>
        <EmptyStateContainer className="min-h-32">
          <EmptyStateTitle>{t("loadingPool")}</EmptyStateTitle>
        </EmptyStateContainer>
      </SectionGroup>
    );
  }

  return (
    <SectionGroup className="max-w-6xl">
      <Section>
        <SectionHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <SectionTitle>{t("embedTitle")}</SectionTitle>
              <SectionDescription>{t("embedDescription")}</SectionDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href={publicHref} target="_blank">
                {t("statusPages")}
                <ExternalLink className="size-3.5" />
              </Link>
            </Button>
          </div>
        </SectionHeader>
        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <div className="space-y-4">
            <div className="rounded-lg border p-4">
              <div className="mb-3 flex items-center gap-2">
                <Code2 className="text-muted-foreground size-4" />
                <div className="text-sm font-medium">{t("embedModules")}</div>
              </div>
              <div className="grid gap-3">
                {SECTION_OPTIONS.map((section) => (
                  <label
                    key={section}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={sections.includes(section)}
                      onCheckedChange={() => toggleSection(section)}
                    />
                    <span>{t(`embedSections.${section}`)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <div className="mb-3 text-sm font-medium">{t("embedTheme")}</div>
              <div className="grid grid-cols-2 gap-2">
                {(["light", "dark"] as const).map((item) => (
                  <Button
                    key={item}
                    type="button"
                    variant={theme === item ? "default" : "outline"}
                    onClick={() => setTheme(item)}
                  >
                    {t(`embedThemes.${item}`)}
                  </Button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <Label className="text-sm font-medium">{t("embedCode")}</Label>
                <Badge variant="outline">{DEFAULT_HEIGHT}px</Badge>
              </div>
              <pre className="bg-muted max-h-56 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                <code>{iframeCode}</code>
              </pre>
              <Button className="mt-3 w-full" type="button" onClick={copyCode}>
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                {copied ? t("copied") : t("copyEmbedCode")}
              </Button>
              <p className="text-muted-foreground mt-3 text-xs leading-5">
                {t("embedCodeHelp")}
              </p>
            </div>
          </div>

          <div className="rounded-lg border bg-slate-50 p-3">
            <iframe
              src={embedUrl}
              title={t("embedPreview")}
              className={cn(
                "h-[680px] w-full rounded-md border bg-white",
                theme === "dark" && "bg-slate-950",
              )}
            />
          </div>
        </div>
      </Section>
    </SectionGroup>
  );
}
