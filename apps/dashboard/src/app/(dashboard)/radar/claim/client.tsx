"use client";

import type { RouterOutputs } from "@openstatus/api";
import { Badge } from "@openstatus/ui/components/ui/badge";
import { Button } from "@openstatus/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openstatus/ui/components/ui/dialog";
import { Input } from "@openstatus/ui/components/ui/input";
import { Label } from "@openstatus/ui/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openstatus/ui/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@openstatus/ui/components/ui/tabs";
import { Textarea } from "@openstatus/ui/components/ui/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Handshake,
  ImagePlus,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionHeaderRow,
  SectionTitle,
} from "@/components/content/section";
import { useTRPC } from "@/lib/trpc/client";

type ClaimApplication =
  RouterOutputs["radar"]["claimApplications"]["items"][number];
type ClaimablePool =
  RouterOutputs["radar"]["listClaimablePools"]["items"][number];
type Filter = "all" | "pending" | "approved" | "rejected";
type Decision = "approved" | "rejected";
type Status = ClaimablePool["worstStatus"];
type EvidenceImage = {
  id: string;
  previewUrl: string;
  file?: File;
  assetId?: string;
};

const PAGE_SIZE = 20;
const MAX_EVIDENCE_IMAGES = 3;
const MAX_EVIDENCE_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_EVIDENCE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function releasePreview(image: EvidenceImage) {
  if (image.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(image.previewUrl);
  }
}

const statusKey: Record<Status, string> = {
  unknown: "unknown",
  operational: "operational",
  degraded: "degraded",
  down: "down",
  paused: "paused",
  configuration_error: "configurationError",
};

function statusVariant(
  status: Status,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "down" || status === "configuration_error") {
    return "destructive";
  }
  if (status === "operational") return "default";
  if (status === "degraded") return "secondary";
  return "outline";
}

function applicationVariant(status: ClaimApplication["status"]) {
  if (status === "approved") return "default" as const;
  if (status === "rejected") return "destructive" as const;
  return "secondary" as const;
}

function formatDate(
  value: Date | string | null | undefined,
  locale: string,
  emptyLabel = "-",
) {
  if (!value) return emptyLabel;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function Client() {
  const t = useTranslations("radar");
  const commonT = useTranslations("common");
  const statusT = useTranslations("status");
  const locale = useLocale();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("pending");
  const [applicationOffset, setApplicationOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [poolOffset, setPoolOffset] = useState(0);
  const [selectedPool, setSelectedPool] = useState<ClaimablePool | null>(null);
  const [selectedApplication, setSelectedApplication] =
    useState<ClaimApplication | null>(null);
  const [proof, setProof] = useState("");
  const [evidenceImages, setEvidenceImages] = useState<EvidenceImage[]>([]);
  const [isUploadingEvidence, setIsUploadingEvidence] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const evidenceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPoolOffset(0);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const applicationInput = {
    status: filter === "all" ? undefined : filter,
    limit: PAGE_SIZE,
    offset: applicationOffset,
  };
  const { data: applicationData, isLoading: applicationsLoading } = useQuery(
    trpc.radar.claimApplications.queryOptions(applicationInput),
  );
  const access = applicationData?.access;
  const applications = useMemo(
    () => applicationData?.items ?? [],
    [applicationData?.items],
  );

  const claimableInput = {
    query: debouncedSearch,
    limit: PAGE_SIZE,
    offset: poolOffset,
  };
  const { data: claimableData, isLoading: poolsLoading } = useQuery({
    ...trpc.radar.listClaimablePools.queryOptions(claimableInput),
    enabled: access?.isAdmin === false,
  });
  const claimablePools = claimableData?.items ?? [];
  const latestApplicationByPool = useMemo(() => {
    const result = new Map<number, ClaimApplication>();
    for (const application of applications) {
      if (!result.has(application.poolId)) {
        result.set(application.poolId, application);
      }
    }
    return result;
  }, [applications]);

  const invalidateClaimData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: trpc.radar.claimApplications.queryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.radar.listClaimablePools.queryKey(),
      }),
      queryClient.invalidateQueries(trpc.radar.listPools.queryOptions({})),
      queryClient.invalidateQueries({
        queryKey: trpc.radar.ownerCandidates.queryKey(),
      }),
    ]);
  };

  const submitClaim = useMutation(
    trpc.radar.submitClaim.mutationOptions({
      onSuccess: async () => {
        await invalidateClaimData();
        toast.success(t("claimApplicationSubmitted"));
        setSelectedPool(null);
        setProof("");
        setEvidenceImages((current) => {
          current.forEach(releasePreview);
          return [];
        });
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const reviewClaim = useMutation(
    trpc.radar.reviewClaim.mutationOptions({
      onSuccess: async () => {
        await invalidateClaimData();
        toast.success(t("claimReviewSaved"));
        setSelectedApplication(null);
        setReviewNote("");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const clearEvidenceImages = () => {
    setEvidenceImages((current) => {
      current.forEach(releasePreview);
      return [];
    });
  };
  const closeClaim = () => {
    if (submitClaim.isPending || isUploadingEvidence) return;
    setSelectedPool(null);
    clearEvidenceImages();
  };
  const openClaim = (pool: ClaimablePool) => {
    const previousApplication = latestApplicationByPool.get(pool.id);
    clearEvidenceImages();
    setSelectedPool(pool);
    setProof(previousApplication?.proof ?? "");
    setEvidenceImages(
      (previousApplication?.evidenceAssets ?? []).map((asset) => ({
        id: asset.id,
        previewUrl: asset.url,
        assetId: asset.id,
      })),
    );
  };
  const addEvidenceFiles = (files: File[]) => {
    const supported = files.filter((file) =>
      ACCEPTED_EVIDENCE_TYPES.has(file.type),
    );
    if (supported.length !== files.length) {
      toast.error(t("claimEvidenceUnsupported"));
    }

    const withinLimit = supported.filter(
      (file) => file.size <= MAX_EVIDENCE_IMAGE_BYTES,
    );
    if (withinLimit.length !== supported.length) {
      toast.error(t("claimEvidenceTooLarge"));
    }

    const available = MAX_EVIDENCE_IMAGES - evidenceImages.length;
    if (withinLimit.length > available || available === 0) {
      toast.error(t("claimEvidenceTooMany"));
    }
    if (available <= 0) return;

    setEvidenceImages((current) => [
      ...current,
      ...withinLimit.slice(0, available).map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  };
  const removeEvidenceImage = (id: string) => {
    setEvidenceImages((current) => {
      const removed = current.find((image) => image.id === id);
      if (removed) releasePreview(removed);
      return current.filter((image) => image.id !== id);
    });
  };
  const submitSelectedClaim = async () => {
    if (!selectedPool || proof.trim().length < 10) return;

    setIsUploadingEvidence(true);
    const uploadedImages = [...evidenceImages];
    try {
      for (let index = 0; index < uploadedImages.length; index += 1) {
        const image = uploadedImages[index];
        if (!image || image.assetId || !image.file) continue;
        const formData = new FormData();
        formData.set("purpose", "claim_evidence");
        formData.set("file", image.file);
        const response = await fetch("/api/media", {
          method: "POST",
          body: formData,
        });
        if (!response.ok) throw new Error("Evidence upload failed");
        const asset = (await response.json()) as {
          id: string;
          url: string;
          mimeType: string;
          sizeBytes: number;
        };
        uploadedImages[index] = {
          ...image,
          assetId: asset.id,
          previewUrl: asset.url,
        };
        releasePreview(image);
        setEvidenceImages([...uploadedImages]);
      }
    } catch {
      toast.error(t("claimEvidenceUploadFailed"));
      return;
    } finally {
      setIsUploadingEvidence(false);
    }

    submitClaim.mutate({
      poolId: selectedPool.id,
      proof: proof.trim(),
      evidenceAssetIds: uploadedImages.flatMap((image) =>
        image.assetId ? [image.assetId] : [],
      ),
    });
  };
  const openReview = (application: ClaimApplication) => {
    setSelectedApplication(application);
    setReviewNote(application.reviewNote ?? "");
  };
  const submitReview = (decision: Decision) => {
    if (!selectedApplication) return;
    reviewClaim.mutate({
      applicationId: selectedApplication.id,
      decision,
      reviewNote,
    });
  };

  if (!access) return null;

  if (access.isAdmin) {
    const canGoNext =
      applicationOffset + PAGE_SIZE < (applicationData?.totalSize ?? 0);
    return (
      <SectionGroup>
        <SectionHeaderRow>
          <SectionHeader>
            <SectionTitle>{t("claimReviewTitle")}</SectionTitle>
            <SectionDescription>
              {t("claimReviewDescription")}
            </SectionDescription>
          </SectionHeader>
          <Button asChild variant="outline" size="sm">
            <Link href="/radar">
              <ArrowLeft />
              {t("backToProviders")}
            </Link>
          </Button>
        </SectionHeaderRow>

        <Section>
          <Tabs
            value={filter}
            onValueChange={(value) => {
              setFilter(value as Filter);
              setApplicationOffset(0);
            }}
          >
            <TabsList>
              <TabsTrigger value="pending">
                {t("claimFilter.pending")}
              </TabsTrigger>
              <TabsTrigger value="approved">
                {t("claimFilter.approved")}
              </TabsTrigger>
              <TabsTrigger value="rejected">
                {t("claimFilter.rejected")}
              </TabsTrigger>
              <TabsTrigger value="all">{t("claimFilter.all")}</TabsTrigger>
            </TabsList>
          </Tabs>

          {applicationsLoading ? (
            <div className="text-muted-foreground py-12 text-center text-sm">
              {t("claimApplicationsLoading")}
            </div>
          ) : applications.length ? (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("claimApplicant")}</TableHead>
                    <TableHead>{t("pool")}</TableHead>
                    <TableHead>{t("claimSubmittedAt")}</TableHead>
                    <TableHead>{commonT("status")}</TableHead>
                    <TableHead className="text-right">
                      {commonT("action")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {applications.map((application) => (
                    <TableRow key={application.id}>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {application.applicant.name ||
                              application.applicant.email}
                          </p>
                          <p className="text-muted-foreground truncate text-xs">
                            {application.applicant.email}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{application.pool.name}</p>
                        <p className="text-muted-foreground font-mono text-xs">
                          /{application.pool.slug}
                        </p>
                      </TableCell>
                      <TableCell>
                        {formatDate(application.createdAt, locale)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={applicationVariant(application.status)}>
                          {t(`claimStatus.${application.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title={t("claimViewApplication")}
                          onClick={() => openReview(application)}
                        >
                          <Eye />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-muted-foreground rounded-md border border-dashed py-12 text-center text-sm">
              {t("claimApplicationsEmpty")}
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-xs">
              {t("claimApplicationCount", {
                count: applicationData?.totalSize ?? 0,
              })}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                title={t("previousPage")}
                disabled={applicationOffset === 0}
                onClick={() =>
                  setApplicationOffset(
                    Math.max(0, applicationOffset - PAGE_SIZE),
                  )
                }
              >
                <ChevronLeft />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                title={t("nextPage")}
                disabled={!canGoNext}
                onClick={() =>
                  setApplicationOffset(applicationOffset + PAGE_SIZE)
                }
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </Section>

        <Dialog
          open={selectedApplication != null}
          onOpenChange={(open) => {
            if (!open && !reviewClaim.isPending) {
              setSelectedApplication(null);
            }
          }}
        >
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t("claimApplicationDetail")}</DialogTitle>
              <DialogDescription>
                {selectedApplication
                  ? `${selectedApplication.pool.name} · ${
                      selectedApplication.applicant.name ||
                      selectedApplication.applicant.email
                    }`
                  : ""}
              </DialogDescription>
            </DialogHeader>
            {selectedApplication && (
              <div className="space-y-5">
                <div>
                  <p className="text-muted-foreground text-xs">
                    {t("claimProof")}
                  </p>
                  <p className="mt-2 rounded-md border bg-slate-50 px-3 py-3 text-sm whitespace-pre-wrap dark:bg-slate-950/30">
                    {selectedApplication.proof}
                  </p>
                </div>
                {selectedApplication.evidenceAssets.length > 0 && (
                  <div>
                    <p className="text-muted-foreground text-xs">
                      {t("claimEvidenceImages")}
                    </p>
                    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {selectedApplication.evidenceAssets.map(
                        (asset, index) => (
                          <a
                            key={asset.id}
                            href={asset.url}
                            target="_blank"
                            rel="noreferrer"
                            className="focus-visible:ring-ring relative aspect-square overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:outline-none"
                          >
                            <Image
                              src={asset.url}
                              alt={t("claimEvidenceImageAlt", {
                                index: index + 1,
                              })}
                              fill
                              sizes="(min-width: 640px) 140px, 30vw"
                              unoptimized
                              className="object-cover transition-opacity hover:opacity-90"
                            />
                          </a>
                        ),
                      )}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="claim-review-note">
                    {t("claimReviewNote")}
                  </Label>
                  <Textarea
                    id="claim-review-note"
                    className="min-h-24 resize-y"
                    value={reviewNote}
                    placeholder={t("claimReviewNotePlaceholder")}
                    disabled={selectedApplication.status !== "pending"}
                    onChange={(event) => setReviewNote(event.target.value)}
                  />
                </div>
                {selectedApplication.status === "pending" && (
                  <p className="bg-muted/50 text-muted-foreground rounded-md px-3 py-2 text-xs">
                    {t("claimApprovalHandoverNotice")}
                  </p>
                )}
              </div>
            )}
            <DialogFooter>
              {selectedApplication?.status === "pending" ? (
                <>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={!reviewNote.trim() || reviewClaim.isPending}
                    onClick={() => submitReview("rejected")}
                  >
                    <XCircle />
                    {t("claimReject")}
                  </Button>
                  <Button
                    type="button"
                    disabled={reviewClaim.isPending}
                    onClick={() => submitReview("approved")}
                  >
                    <CheckCircle2 />
                    {t("claimApprove")}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelectedApplication(null)}
                >
                  {t("close")}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SectionGroup>
    );
  }

  const canGoNextPool =
    poolOffset + PAGE_SIZE < (claimableData?.totalSize ?? 0);

  return (
    <SectionGroup>
      <SectionHeaderRow>
        <SectionHeader>
          <SectionTitle>{t("claimPageTitle")}</SectionTitle>
          <SectionDescription>{t("claimPageDescription")}</SectionDescription>
        </SectionHeader>
        <Button asChild variant="outline" size="sm">
          <Link href="/radar">
            <ArrowLeft />
            {t("backToProviders")}
          </Link>
        </Button>
      </SectionHeaderRow>

      {access.verificationStatus !== "verified" ? (
        <div className="flex flex-col gap-4 rounded-md border border-l-4 border-l-slate-400 bg-slate-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:bg-slate-950/30">
          <div>
            <p className="text-sm font-medium">
              {t("claimVerificationRequiredTitle")}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("claimVerificationRequiredDescription")}
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href="/verification">{t("verifyToClaim")}</Link>
          </Button>
        </div>
      ) : (
        <Section>
          <SectionHeaderRow>
            <SectionHeader>
              <SectionTitle>{t("claimableProviders")}</SectionTitle>
              <SectionDescription>
                {t("claimableProvidersDescription")}
              </SectionDescription>
            </SectionHeader>
            <div className="relative w-full sm:w-72">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("claimSearchPlaceholder")}
                className="pl-9"
              />
            </div>
          </SectionHeaderRow>

          {poolsLoading ? (
            <div className="text-muted-foreground py-12 text-center text-sm">
              {t("claimableProvidersLoading")}
            </div>
          ) : claimablePools.length ? (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("pool")}</TableHead>
                    <TableHead>{commonT("status")}</TableHead>
                    <TableHead>{t("targets")}</TableHead>
                    <TableHead>{t("lastCheck")}</TableHead>
                    <TableHead className="text-right">
                      {commonT("action")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {claimablePools.map((pool) => {
                    const application = latestApplicationByPool.get(pool.id);
                    const pending = application?.status === "pending";
                    return (
                      <TableRow key={pool.id}>
                        <TableCell>
                          <p className="font-medium">{pool.name}</p>
                          <p className="text-muted-foreground font-mono text-xs">
                            /{pool.slug}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(pool.worstStatus)}>
                            {statusT(statusKey[pool.worstStatus])}
                          </Badge>
                        </TableCell>
                        <TableCell>{pool.targetCount}</TableCell>
                        <TableCell>
                          {formatDate(
                            pool.lastCheckAt,
                            locale,
                            commonT("never"),
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={pending || !access.canCreate}
                            title={
                              pending
                                ? t("claimPending")
                                : access.canCreate
                                  ? undefined
                                  : t("claimQuotaFull")
                            }
                            onClick={() => openClaim(pool)}
                          >
                            <Handshake />
                            {pending
                              ? t("claimPending")
                              : application?.status === "rejected"
                                ? t("claimReapply")
                                : access.canCreate
                                  ? t("claimApply")
                                  : t("claimQuotaFull")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-muted-foreground rounded-md border border-dashed py-12 text-center text-sm">
              {t("claimableProvidersEmpty")}
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-xs">
              {t("claimableProviderCount", {
                count: claimableData?.totalSize ?? 0,
              })}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                title={t("previousPage")}
                disabled={poolOffset === 0}
                onClick={() =>
                  setPoolOffset(Math.max(0, poolOffset - PAGE_SIZE))
                }
              >
                <ChevronLeft />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                title={t("nextPage")}
                disabled={!canGoNextPool}
                onClick={() => setPoolOffset(poolOffset + PAGE_SIZE)}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </Section>
      )}

      {applications.length > 0 && (
        <Section>
          <SectionHeader>
            <SectionTitle>{t("myClaimApplications")}</SectionTitle>
            <SectionDescription>
              {t("myClaimApplicationsDescription")}
            </SectionDescription>
          </SectionHeader>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pool")}</TableHead>
                  <TableHead>{commonT("status")}</TableHead>
                  <TableHead>{t("claimSubmittedAt")}</TableHead>
                  <TableHead>{t("claimReviewNote")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((application) => (
                  <TableRow key={application.id}>
                    <TableCell>
                      <p className="font-medium">{application.pool.name}</p>
                      <p className="text-muted-foreground font-mono text-xs">
                        /{application.pool.slug}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={applicationVariant(application.status)}>
                        {t(`claimStatus.${application.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {formatDate(application.createdAt, locale)}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-80 whitespace-normal">
                      {application.reviewNote || "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
      )}

      <Dialog
        open={selectedPool != null}
        onOpenChange={(open) => {
          if (!open) closeClaim();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("claimApplicationTitle")}</DialogTitle>
            <DialogDescription>
              {t("claimApplicationDescription", {
                name: selectedPool?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="claim-proof">{t("claimProof")}</Label>
            <Textarea
              id="claim-proof"
              className="min-h-32 resize-y"
              value={proof}
              placeholder={t("claimProofPlaceholder")}
              disabled={submitClaim.isPending || isUploadingEvidence}
              onChange={(event) => setProof(event.target.value)}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.items).flatMap(
                  (item) => {
                    if (item.kind !== "file") return [];
                    const file = item.getAsFile();
                    return file ? [file] : [];
                  },
                );
                if (files.length > 0) {
                  event.preventDefault();
                  addEvidenceFiles(files);
                }
              }}
            />
            <p className="text-muted-foreground text-xs">
              {t("claimProofHelp")}
            </p>
          </div>
          <div className="space-y-2">
            <Label>{t("claimEvidenceImages")}</Label>
            <input
              ref={evidenceInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              disabled={submitClaim.isPending || isUploadingEvidence}
              onChange={(event) => {
                addEvidenceFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            {evidenceImages.length < MAX_EVIDENCE_IMAGES && (
              <button
                type="button"
                className="border-muted-foreground/30 hover:bg-muted/40 focus-visible:ring-ring flex w-full items-center gap-3 rounded-md border border-dashed px-3 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                disabled={submitClaim.isPending || isUploadingEvidence}
                onClick={() => evidenceInputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  addEvidenceFiles(Array.from(event.dataTransfer.files));
                }}
              >
                <ImagePlus className="text-muted-foreground size-5 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {t("claimEvidenceAdd")}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {t("claimEvidenceDrop")}
                  </span>
                </span>
              </button>
            )}
            {evidenceImages.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {evidenceImages.map((image, index) => (
                  <div
                    key={image.id}
                    className="relative size-20 overflow-hidden rounded-md border"
                  >
                    <Image
                      src={image.previewUrl}
                      alt={t("claimEvidenceImageAlt", { index: index + 1 })}
                      fill
                      sizes="80px"
                      unoptimized
                      className="object-cover"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="absolute top-1 right-1 size-6"
                      title={t("claimEvidenceRemove")}
                      disabled={submitClaim.isPending || isUploadingEvidence}
                      onClick={() => removeEvidenceImage(image.id)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="bg-muted/50 text-muted-foreground rounded-md px-3 py-2 text-xs">
            {t("claimReviewProcessNotice")}
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitClaim.isPending || isUploadingEvidence}
              onClick={closeClaim}
            >
              {commonT("cancel")}
            </Button>
            <Button
              type="button"
              disabled={
                selectedPool == null ||
                proof.trim().length < 10 ||
                submitClaim.isPending ||
                isUploadingEvidence
              }
              onClick={submitSelectedClaim}
            >
              <Handshake />
              {isUploadingEvidence
                ? t("claimUploadingImages")
                : submitClaim.isPending
                  ? t("claimSubmitting")
                  : t("claimSubmit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionGroup>
  );
}
