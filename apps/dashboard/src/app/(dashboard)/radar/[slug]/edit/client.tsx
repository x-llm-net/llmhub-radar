"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import { Checkbox } from "@openstatus/ui/components/ui/checkbox";
import { Input } from "@openstatus/ui/components/ui/input";
import { Label } from "@openstatus/ui/components/ui/label";
import { Textarea } from "@openstatus/ui/components/ui/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ImageUp, LoaderCircle, Save, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ACCEPTED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

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
  const [homepageUrl, setHomepageUrl] = useState("");
  const [pricingUrl, setPricingUrl] = useState("");
  const [contactUrl, setContactUrl] = useState("");
  const [redirectUrlTemplate, setRedirectUrlTemplate] = useState("");
  const [contactQq, setContactQq] = useState("");
  const [publicPoolOptIn, setPublicPoolOptIn] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoAssetId, setLogoAssetId] = useState<string | null | undefined>(
    undefined,
  );
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pool) return;
    setName(pool.name);
    setSlug(pool.slug);
    setDescription(pool.description);
    setBaseUrl(pool.providers[0]?.baseUrl ?? "");
    setHomepageUrl(pool.homepageUrl ?? "");
    setPricingUrl(pool.pricingUrl ?? "");
    setContactUrl(pool.contactUrl ?? "");
    setRedirectUrlTemplate(pool.redirectUrlTemplate ?? "");
    setContactQq(pool.contactQq ?? "");
    setPublicPoolOptIn(pool.publicPoolOptIn);
    setLogoUrl(pool.logoUrl);
    setLogoAssetId(undefined);
  }, [pool]);

  const deleteTemporaryLogo = async (assetId: string) => {
    await fetch(`/api/media/${assetId}`, { method: "DELETE" }).catch(
      () => undefined,
    );
  };

  const uploadLogo = async (file: File) => {
    if (!ACCEPTED_LOGO_TYPES.has(file.type)) {
      toast.error(t("providerLogoUnsupported"));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error(t("providerLogoTooLarge"));
      return;
    }

    setIsUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.set("purpose", "provider_logo");
      formData.set("file", file);
      const response = await fetch("/api/media", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error("Logo upload failed");
      const asset = (await response.json()) as { id: string; url: string };
      if (typeof logoAssetId === "string") {
        void deleteTemporaryLogo(logoAssetId);
      }
      setLogoAssetId(asset.id);
      setLogoUrl(asset.url);
    } catch {
      toast.error(t("providerLogoUploadFailed"));
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const removeLogo = () => {
    if (typeof logoAssetId === "string") {
      void deleteTemporaryLogo(logoAssetId);
    }
    setLogoAssetId(null);
    setLogoUrl(null);
  };

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
          className="bg-card grid max-w-4xl gap-8 rounded-lg border p-5 shadow-sm sm:p-7"
          onSubmit={(event) => {
            event.preventDefault();
            if (isUploadingLogo) return;
            updatePool.mutate({
              currentSlug: pool.slug,
              name,
              slug,
              description,
              baseUrl,
              homepageUrl,
              pricingUrl,
              contactUrl,
              redirectUrlTemplate,
              contactQq,
              ...(logoAssetId !== undefined ? { logoAssetId } : {}),
              publicPoolOptIn,
            });
          }}
        >
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
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2 md:row-span-2">
              <Label>{t("providerLogo")}</Label>
              <div className="flex min-h-20 items-center gap-3">
                <div className="bg-muted relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt={t("providerLogoAlt", { name: name || pool.name })}
                      className="size-full object-cover"
                    />
                  ) : (
                    <span className="text-muted-foreground text-2xl font-semibold">
                      {(name || pool.name).trim().charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 flex-wrap gap-2">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    disabled={isUploadingLogo || updatePool.isPending}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadLogo(file);
                      event.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isUploadingLogo || updatePool.isPending}
                    onClick={() => logoInputRef.current?.click()}
                  >
                    {isUploadingLogo ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <ImageUp className="size-4" />
                    )}
                    {isUploadingLogo
                      ? t("providerLogoUploading")
                      : logoUrl
                        ? t("providerLogoReplace")
                        : t("providerLogoUpload")}
                  </Button>
                  {logoUrl && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title={t("providerLogoRemove")}
                      disabled={isUploadingLogo || updatePool.isPending}
                      onClick={removeLogo}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-muted-foreground text-xs">
                {t("providerLogoHelp")}
              </p>
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
                {t("baseUrlEditHelp")}
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
          <div className="flex flex-col gap-2 border-t pt-5 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" asChild>
              <Link href={`/radar/${pool.slug}`}>
                <ArrowLeft className="size-4" />
                {commonT("cancel")}
              </Link>
            </Button>
            <Button
              type="submit"
              disabled={updatePool.isPending || isUploadingLogo}
            >
              <Save className="size-4" />
              {updatePool.isPending ? t("saving") : t("savePool")}
            </Button>
          </div>
        </form>
      </Section>
    </SectionGroup>
  );
}
