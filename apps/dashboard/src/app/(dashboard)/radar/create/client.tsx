"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@openstatus/ui/components/ui/alert";
import { Button } from "@openstatus/ui/components/ui/button";
import { Checkbox } from "@openstatus/ui/components/ui/checkbox";
import { Input } from "@openstatus/ui/components/ui/input";
import { Label } from "@openstatus/ui/components/ui/label";
import { Textarea } from "@openstatus/ui/components/ui/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Info, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
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
import {
  RadarOwnerPicker,
  type RadarOwnerCandidate,
} from "@/components/radar/owner-picker";
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

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [homepageUrl, setHomepageUrl] = useState("");
  const [pricingUrl, setPricingUrl] = useState("");
  const [contactUrl, setContactUrl] = useState("");
  const [redirectUrlTemplate, setRedirectUrlTemplate] = useState("");
  const [contactQq, setContactQq] = useState("");
  const [publicPoolOptIn, setPublicPoolOptIn] = useState(true);
  const [ownerSelection, setOwnerSelection] = useState("platform");
  const [selectedOwner, setSelectedOwner] =
    useState<RadarOwnerCandidate | null>(null);

  const { data: poolData } = useQuery(
    trpc.radar.listPools.queryOptions({ limit: 1 }),
  );
  const isAdmin = poolData?.access.isAdmin === true;
  const selectedOwnerAtLimit =
    selectedOwner?.providerLimit != null &&
    selectedOwner.providerUsage >= selectedOwner.providerLimit;
  const canSubmit =
    poolData?.access.canCreate === true && !selectedOwnerAtLimit;

  const createPool = useMutation(
    trpc.radar.createPool.mutationOptions({
      onSuccess: async (pool) => {
        await queryClient.invalidateQueries(
          trpc.radar.listPools.queryOptions({}),
        );
        toast.success(t("poolCreated"));
        router.push(
          isAdmin && ownerSelection !== "platform"
            ? "/radar"
            : `/radar/${pool.slug}`,
        );
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

        {poolData?.access && (
          <Alert>
            <Info className="size-4" />
            <AlertTitle>
              {poolData.access.isAdmin
                ? t("adminUnlimited")
                : t("quotaUsed", {
                    used: poolData.access.providerUsage,
                    limit: poolData.access.providerLimit ?? 0,
                  })}
            </AlertTitle>
            <AlertDescription>
              {poolData.access.isAdmin
                ? t("adminCreateDescription")
                : poolData.access.canCreate
                  ? t("quotaCreateDescription")
                  : t("quotaReachedDescription")}
            </AlertDescription>
          </Alert>
        )}

        <form
          className="bg-card grid max-w-4xl gap-8 rounded-lg border p-5 shadow-sm sm:p-7"
          onSubmit={(event) => {
            event.preventDefault();
            createPool.mutate({
              name,
              slug,
              description,
              homepageUrl,
              pricingUrl,
              contactUrl,
              redirectUrlTemplate,
              contactQq,
              visibility: "unlisted",
              publicPoolOptIn,
              ownerUserId:
                isAdmin && ownerSelection !== "platform"
                  ? Number(ownerSelection)
                  : undefined,
              provider: {
                displayName: name,
                baseUrl,
                baseUrlVisibility: "hidden",
                providerType: "openai_compatible",
              },
            });
          }}
        >
          {isAdmin && (
            <div className="space-y-2">
              <Label htmlFor="radar-owner">{t("owner")}</Label>
              <RadarOwnerPicker
                value={ownerSelection}
                onValueChange={setOwnerSelection}
                onCandidateChange={setSelectedOwner}
              />
              <p className="text-muted-foreground text-xs">
                {ownerSelection === "platform"
                  ? t("platformManagedHelp")
                  : t("assignedOwnerHelp")}
              </p>
            </div>
          )}

          <div className="grid gap-x-5 gap-y-5 md:grid-cols-2">
            <div className="space-y-1 border-b pb-3 md:col-span-2">
              <h2 className="text-sm font-semibold">{t("basicInfo")}</h2>
              <p className="text-muted-foreground text-sm">
                {t("basicInfoDescription")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="radar-name">{t("poolName")}</Label>
              <Input
                id="radar-name"
                value={name}
                placeholder={t("poolNamePlaceholder")}
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
                placeholder={t("publicSlugPlaceholder")}
                onChange={(event) => setSlug(toSlug(event.target.value))}
                required
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="radar-description">{t("officialIntro")}</Label>
              <Textarea
                id="radar-description"
                className="min-h-36 resize-y"
                value={description}
                placeholder={t("officialIntroPlaceholder")}
                onChange={(event) => setDescription(event.target.value)}
                rows={5}
              />
              <p className="text-muted-foreground text-xs">
                {t("officialIntroHelp")}
              </p>
            </div>
          </div>
          <div className="grid gap-x-5 gap-y-5 md:grid-cols-2">
            <div className="space-y-1 border-b pb-3 md:col-span-2">
              <h2 className="text-sm font-semibold">{t("publicLinks")}</h2>
              <p className="text-muted-foreground text-sm">
                {t("publicLinksDescription")}
              </p>
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
              <p className="text-muted-foreground text-xs">
                {t("baseUrlHelp")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="radar-homepage-url">{t("homepageUrl")}</Label>
              <Input
                id="radar-homepage-url"
                value={homepageUrl}
                placeholder={t("homepageUrlPlaceholder")}
                onChange={(event) => setHomepageUrl(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t("homepageUrlHelp")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="radar-pricing-url">{t("pricingUrl")}</Label>
              <Input
                id="radar-pricing-url"
                value={pricingUrl}
                placeholder={t("pricingUrlPlaceholder")}
                onChange={(event) => setPricingUrl(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t("optionalPublicLinkHelp")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="radar-contact-url">{t("contactUrl")}</Label>
              <Input
                id="radar-contact-url"
                value={contactUrl}
                placeholder={t("contactUrlPlaceholder")}
                onChange={(event) => setContactUrl(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t("contactUrlHelp")}
              </p>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="radar-redirect-url">
                {t("redirectUrlTemplate")}
              </Label>
              <Input
                id="radar-redirect-url"
                value={redirectUrlTemplate}
                placeholder={t("redirectUrlTemplatePlaceholder")}
                onChange={(event) => setRedirectUrlTemplate(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t("redirectUrlTemplateHelp")}
              </p>
            </div>
          </div>
          <div className="grid gap-x-5 gap-y-5 md:grid-cols-2">
            <div className="space-y-1 border-b pb-3 md:col-span-2">
              <h2 className="text-sm font-semibold">
                {t("operationsSettings")}
              </h2>
              <p className="text-muted-foreground text-sm">
                {t("operationsSettingsDescription")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="radar-contact-qq">{t("contactQq")}</Label>
              <Input
                id="radar-contact-qq"
                value={contactQq}
                placeholder={t("contactQqPlaceholder")}
                onChange={(event) => setContactQq(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t("contactQqHelp")}
              </p>
            </div>
            <label className="bg-muted/30 hover:bg-muted/50 flex items-start gap-3 rounded-md border p-4 transition-colors">
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
          <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-sm">
              {selectedOwnerAtLimit
                ? t("selectedOwnerQuotaReached")
                : t("createProviderHint")}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" asChild>
                <Link href="/radar">
                  <ArrowLeft className="size-4" />
                  {commonT("cancel")}
                </Link>
              </Button>
              <Button
                type="submit"
                disabled={!canSubmit || createPool.isPending}
              >
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
