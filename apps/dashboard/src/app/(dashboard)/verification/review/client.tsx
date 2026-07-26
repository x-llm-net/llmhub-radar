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
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
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

type Application =
  RouterOutputs["radar"]["verificationApplications"]["items"][number];
type Filter = "all" | "pending" | "approved" | "rejected";
type Decision = "approved" | "rejected";

const PAGE_SIZE = 50;

function formatDate(value: Date | string | null, locale: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function Client() {
  const t = useTranslations("verification");
  const ordersT = useTranslations("orders");
  const locale = useLocale();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("pending");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Application | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  const { data: overview } = useQuery(
    trpc.radar.verificationOverview.queryOptions(),
  );
  const input = {
    status: filter === "all" ? undefined : filter,
    limit: PAGE_SIZE,
    offset,
  };
  const { data, isLoading } = useQuery({
    ...trpc.radar.verificationApplications.queryOptions(input),
    enabled: overview?.access.isAdmin === true,
  });

  const review = useMutation(
    trpc.radar.reviewVerification.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.radar.verificationApplications.queryKey(),
        });
        toast.success(t("reviewSaved"));
        setSelected(null);
        setReviewNote("");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (!overview) return null;
  if (!overview.access.isAdmin) {
    return (
      <SectionGroup>
        <SectionHeader>
          <SectionTitle>{t("reviewForbidden")}</SectionTitle>
          <SectionDescription>
            {t("reviewForbiddenDescription")}
          </SectionDescription>
        </SectionHeader>
        <Button asChild variant="outline" className="w-fit">
          <Link href="/verification">
            <ArrowLeft />
            {t("backToVerification")}
          </Link>
        </Button>
      </SectionGroup>
    );
  }

  const openReview = (application: Application) => {
    setSelected(application);
    setReviewNote(application.reviewNote ?? "");
  };
  const submitReview = (decision: Decision) => {
    if (!selected) return;
    review.mutate({
      applicationId: selected.id,
      decision,
      reviewNote,
    });
  };
  const canGoNext = offset + PAGE_SIZE < (data?.totalSize ?? 0);

  return (
    <SectionGroup>
      <SectionHeaderRow>
        <SectionHeader>
          <SectionTitle>{t("reviewTitle")}</SectionTitle>
          <SectionDescription>{t("reviewDescription")}</SectionDescription>
        </SectionHeader>
        <Button asChild variant="outline" size="sm">
          <Link href="/verification">
            <ArrowLeft />
            {t("backToVerification")}
          </Link>
        </Button>
      </SectionHeaderRow>

      <Section>
        <Tabs
          value={filter}
          onValueChange={(value) => {
            setFilter(value as Filter);
            setOffset(0);
          }}
        >
          <TabsList>
            <TabsTrigger value="pending">{t("filter.pending")}</TabsTrigger>
            <TabsTrigger value="approved">{t("filter.approved")}</TabsTrigger>
            <TabsTrigger value="rejected">{t("filter.rejected")}</TabsTrigger>
            <TabsTrigger value="all">{t("filter.all")}</TabsTrigger>
          </TabsList>
        </Tabs>

        {isLoading ? (
          <div className="text-muted-foreground py-12 text-center text-sm">
            {t("loadingApplications")}
          </div>
        ) : data?.items.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("applicant")}</TableHead>
                  <TableHead>{t("type")}</TableHead>
                  <TableHead>{t("subject")}</TableHead>
                  <TableHead>{t("submittedAt")}</TableHead>
                  <TableHead>{t("statusLabel")}</TableHead>
                  <TableHead className="w-20 text-right">
                    {t("action")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((application) => (
                  <TableRow key={application.id}>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {application.user.name || application.user.email}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {application.user.email}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {application.isUpgrade
                        ? t("enterpriseUpgrade")
                        : t(application.type)}
                    </TableCell>
                    <TableCell className="max-w-56 truncate">
                      {application.type === "personal"
                        ? application.realName
                        : application.companyName}
                    </TableCell>
                    <TableCell>
                      {formatDate(application.createdAt, locale)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          application.status === "approved"
                            ? "default"
                            : application.status === "rejected"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {t(`applicationStatus.${application.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title={t("viewApplication")}
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
          <div className="text-muted-foreground rounded-lg border border-dashed py-12 text-center text-sm">
            {t("emptyApplications")}
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-xs">
            {t("applicationCount", { count: data?.totalSize ?? 0 })}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              title={t("previousPage")}
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              <ChevronLeft />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              title={t("nextPage")}
              disabled={!canGoNext}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </Section>

      <Dialog
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("applicationDetail")}</DialogTitle>
            <DialogDescription>
              {selected
                ? `${selected.user.name || selected.user.email} · ${
                    selected.isUpgrade
                      ? t("enterpriseUpgrade")
                      : t(selected.type)
                  }`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-6">
              <dl className="grid gap-x-5 gap-y-4 text-sm sm:grid-cols-2">
                {selected.type === "personal" ? (
                  <>
                    <div>
                      <dt className="text-muted-foreground text-xs">
                        {t("realName")}
                      </dt>
                      <dd className="mt-1 font-medium">{selected.realName}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">
                        {t("identityNumber")}
                      </dt>
                      <dd className="mt-1 font-medium">
                        {selected.identityNumber ||
                          selected.identityNumberMasked ||
                          "-"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">
                        {t("mobile")}
                      </dt>
                      <dd className="mt-1 font-medium">
                        {selected.mobile || selected.mobileMasked || "-"}
                      </dd>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <dt className="text-muted-foreground text-xs">
                        {t("companyName")}
                      </dt>
                      <dd className="mt-1 font-medium">
                        {selected.companyName}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">
                        {t("creditCode")}
                      </dt>
                      <dd className="mt-1 font-medium">
                        {selected.creditCode}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">
                        {t("legalRepresentativeName")}
                      </dt>
                      <dd className="mt-1 font-medium">
                        {selected.legalRepresentativeName}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">
                        {t("legalRepresentativeIdentityNumber")}
                      </dt>
                      <dd className="mt-1 font-medium">
                        {selected.identityNumber ||
                          selected.identityNumberMasked ||
                          "-"}
                      </dd>
                    </div>
                  </>
                )}
              </dl>

              <div className="space-y-2">
                <Label htmlFor="verification-review-note">
                  {t("reviewNote")}
                </Label>
                <Textarea
                  id="verification-review-note"
                  className="min-h-24 resize-y"
                  value={reviewNote}
                  placeholder={t("reviewNotePlaceholder")}
                  onChange={(event) => setReviewNote(event.target.value)}
                  disabled={selected.status !== "pending"}
                />
              </div>

              {selected.status === "pending" && !selected.isUpgrade && (
                <div className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {t("paymentOrderStatus")}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {selected.orderStatus
                        ? ordersT(`status.${selected.orderStatus}`)
                        : t("paymentOrderMissing")}
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/orders">{t("viewOrders")}</Link>
                  </Button>
                </div>
              )}
              {selected.status === "pending" && selected.isUpgrade && (
                <p className="bg-muted/50 text-muted-foreground rounded-md px-3 py-2 text-xs">
                  {t("upgradeReviewFeeNotice")}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            {selected?.status === "pending" ? (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={!reviewNote.trim() || review.isPending}
                  onClick={() => submitReview("rejected")}
                >
                  <XCircle />
                  {t("reject")}
                </Button>
                <Button
                  type="button"
                  disabled={
                    (!selected.isUpgrade &&
                      selected.orderStatus !== "paid" &&
                      selected.orderStatus !== "active") ||
                    review.isPending
                  }
                  onClick={() => submitReview("approved")}
                >
                  <CheckCircle2 />
                  {t("approve")}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => setSelected(null)}
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
