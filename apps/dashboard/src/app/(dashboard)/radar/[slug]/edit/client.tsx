"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import { Checkbox } from "@openstatus/ui/components/ui/checkbox";
import { Input } from "@openstatus/ui/components/ui/input";
import { Label } from "@openstatus/ui/components/ui/label";
import { Textarea } from "@openstatus/ui/components/ui/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
import { useTRPC } from "@/lib/trpc/client";

function toSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function Client() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const t = useTranslations("radar");
  const commonT = useTranslations("common");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const poolQueryOptions = trpc.radar.getPool.queryOptions({
    slug: params.slug,
  });
  const { data: pool } = useQuery(poolQueryOptions);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [publicPoolOptIn, setPublicPoolOptIn] = useState(false);

  useEffect(() => {
    if (!pool) return;
    setName(pool.name);
    setSlug(pool.slug);
    setDescription(pool.description);
    setBaseUrl(pool.providers[0]?.baseUrl ?? "");
    setPublicPoolOptIn(pool.publicPoolOptIn);
  }, [pool]);

  const updatePool = useMutation(
    trpc.radar.updatePool.mutationOptions({
      onSuccess: async (updatedPool) => {
        await queryClient.invalidateQueries(
          trpc.radar.listPools.queryOptions({}),
        );
        await queryClient.invalidateQueries(poolQueryOptions);
        toast.success(t("poolUpdated"));
        router.push(`/radar/${updatedPool.slug}`);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

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
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>{t("editPool")}</SectionTitle>
          <SectionDescription>{t("editPoolDescription")}</SectionDescription>
        </SectionHeader>
        <form
          className="grid max-w-3xl gap-4 rounded-md border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            updatePool.mutate({
              currentSlug: pool.slug,
              name,
              slug,
              description,
              baseUrl,
              publicPoolOptIn,
            });
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="radar-name">{t("poolName")}</Label>
              <Input
                id="radar-name"
                value={name}
                placeholder={t("poolNamePlaceholder")}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="radar-slug">{t("publicSlug")}</Label>
              <Input
                id="radar-slug"
                value={slug}
                placeholder={t("publicSlugPlaceholder")}
                onChange={(event) => setSlug(toSlug(event.target.value))}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="radar-description">{t("formDescription")}</Label>
            <Textarea
              id="radar-description"
              value={description}
              placeholder={t("formDescriptionPlaceholder")}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="radar-base-url">{t("baseUrl")}</Label>
              <Input
                id="radar-base-url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://example.com"
                required
              />
              <p className="text-muted-foreground text-xs">
                {t("baseUrlEditHelp")}
              </p>
            </div>
            <label className="flex items-start gap-3 rounded-md border p-3">
              <Checkbox
                checked={publicPoolOptIn}
                onCheckedChange={(checked) =>
                  setPublicPoolOptIn(checked === true)
                }
              />
              <span className="grid gap-1 text-sm leading-none">
                <span className="font-medium">{t("publicPoolOptIn")}</span>
                <span className="text-muted-foreground leading-relaxed">
                  {t("publicPoolOptInDescription")}
                </span>
              </span>
            </label>
          </div>
          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" asChild>
              <Link href={`/radar/${pool.slug}`}>
                <ArrowLeft className="size-4" />
                {commonT("cancel")}
              </Link>
            </Button>
            <Button type="submit" disabled={updatePool.isPending}>
              <Save className="size-4" />
              {updatePool.isPending ? t("saving") : t("savePool")}
            </Button>
          </div>
        </form>
      </Section>
    </SectionGroup>
  );
}
