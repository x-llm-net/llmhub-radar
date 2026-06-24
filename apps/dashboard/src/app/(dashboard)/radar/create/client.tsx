"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@openstatus/ui/components/ui/button";
import { Input } from "@openstatus/ui/components/ui/input";
import { Label } from "@openstatus/ui/components/ui/label";
import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

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
  const t = useTranslations("radar");
  const commonT = useTranslations("common");
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = useState(() => t("demo.poolName"));
  const [slug, setSlug] = useState(() => t("demo.slug"));
  const [description, setDescription] = useState(() => t("demo.description"));
  const [providerName, setProviderName] = useState(() => t("demo.providerName"));
  const [baseUrl, setBaseUrl] = useState("");

  const createPool = useMutation(
    trpc.radar.createPool.mutationOptions({
      onSuccess: async (pool) => {
        await queryClient.invalidateQueries(trpc.radar.listPools.queryOptions({}));
        toast.success(t("poolCreated"));
        router.push(`/radar/${pool.slug}`);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>{t("createPool")}</SectionTitle>
          <SectionDescription>{t("createPoolDescription")}</SectionDescription>
        </SectionHeader>
        <form
          className="grid max-w-3xl gap-4 rounded-md border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            createPool.mutate({
              name,
              slug,
              description,
              visibility: "private",
              publicPoolOptIn: false,
              provider: {
                displayName: providerName,
                baseUrl,
                baseUrlVisibility: "hidden",
                providerType: "openai_compatible",
              },
            });
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="radar-name">{t("poolName")}</Label>
              <Input
                id="radar-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setSlug(toSlug(event.target.value));
                }}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="radar-slug">{t("publicSlug")}</Label>
              <Input
                id="radar-slug"
                value={slug}
                onChange={(event) => setSlug(toSlug(event.target.value))}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="radar-description">{t("formDescription")}</Label>
            <Input
              id="radar-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="radar-provider">{t("namedProvider")}</Label>
              <Input
                id="radar-provider"
                value={providerName}
                onChange={(event) => setProviderName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="radar-base-url">{t("baseUrl")}</Label>
              <Input
                id="radar-base-url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://example.com"
                required
              />
            </div>
          </div>
          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-sm">{t("createProviderHint")}</p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" asChild>
                <Link href="/radar">
                  <ArrowLeft className="size-4" />
                  {commonT("cancel")}
                </Link>
              </Button>
              <Button type="submit" disabled={createPool.isPending}>
                <Plus className="size-4" />
                {createPool.isPending ? t("creating") : t("createPool")}
              </Button>
            </div>
          </div>
        </form>
      </Section>
    </SectionGroup>
  );
}
