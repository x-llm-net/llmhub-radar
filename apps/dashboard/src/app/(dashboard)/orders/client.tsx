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
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  ImagePlus,
  ReceiptText,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
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

type Order = RouterOutputs["radar"]["orders"]["items"][number];
type OrderStatus = Order["status"];
type Filter = "all" | "pending_review" | "paid" | "active" | "rejected";
type Decision = "approved" | "rejected";
type ReceiptFile = { file: File; previewUrl: string };

const PAGE_SIZE = 50;
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const ACCEPTED_RECEIPT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

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

function formatAmount(amountCents: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
  }).format(amountCents / 100);
}

function statusVariant(
  status: OrderStatus,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "rejected") return "destructive";
  if (status === "active" || status === "paid") return "default";
  if (status === "pending_review") return "secondary";
  return "outline";
}

export function Client() {
  const t = useTranslations("orders");
  const verificationT = useTranslations("verification");
  const locale = useLocale();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [offset, setOffset] = useState(0);
  const [receiptFile, setReceiptFile] = useState<ReceiptFile | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  const { data: overview } = useQuery(
    trpc.radar.verificationOverview.queryOptions(),
  );
  const ordersInput = {
    status: filter === "all" ? undefined : filter,
    limit: PAGE_SIZE,
    offset,
  };
  const { data, isLoading } = useQuery(
    trpc.radar.orders.queryOptions(ordersInput),
  );

  const invalidateOrders = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: trpc.radar.orders.queryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.radar.verificationOverview.queryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.radar.verificationApplications.queryKey(),
      }),
    ]);
  };
  const createOrder = useMutation(
    trpc.radar.createPermanentOrder.mutationOptions({
      onSuccess: async () => {
        await invalidateOrders();
        toast.success(t("orderCreated"));
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const submitReceipt = useMutation(
    trpc.radar.submitOrderReceipt.mutationOptions({
      onSuccess: async () => {
        await invalidateOrders();
        toast.success(t("receiptSubmitted"));
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const reviewOrder = useMutation(
    trpc.radar.reviewOrder.mutationOptions({
      onSuccess: async () => {
        await invalidateOrders();
        toast.success(t("reviewSaved"));
        setSelected(null);
        setReviewNote("");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (!overview || !data) return null;

  const { access, applications, activeVerificationType } = overview;
  const isAdmin = access.isAdmin;
  const pendingApplication = applications.find(
    (application) => application.status === "pending",
  );
  const isEnterpriseUpgrade =
    access.verificationStatus === "verified" &&
    activeVerificationType === "personal" &&
    pendingApplication?.type === "enterprise";
  const currentOrder = data.items.find(
    (order) =>
      order.type === "permanent_listing" &&
      order.status !== "cancelled" &&
      order.status !== "refunded",
  );
  const orderMatchesPendingApplication =
    currentOrder?.verificationApplicationId === pendingApplication?.id;
  const canCreateOrRelink =
    !isAdmin &&
    pendingApplication != null &&
    !isEnterpriseUpgrade &&
    !orderMatchesPendingApplication;
  const canUploadReceipt =
    !isAdmin &&
    currentOrder != null &&
    orderMatchesPendingApplication &&
    (currentOrder.status === "pending_payment" ||
      currentOrder.status === "rejected");

  const clearReceiptFile = () => {
    setReceiptFile((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
  };
  const selectReceipt = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (!ACCEPTED_RECEIPT_TYPES.has(file.type)) {
      toast.error(t("receiptUnsupported"));
      return;
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      toast.error(t("receiptTooLarge"));
      return;
    }
    clearReceiptFile();
    setReceiptFile({ file, previewUrl: URL.createObjectURL(file) });
  };
  const uploadReceipt = async () => {
    if (!currentOrder || !receiptFile) return;
    setIsUploading(true);
    let uploaded = false;
    try {
      const formData = new FormData();
      formData.set("purpose", "order_receipt");
      formData.set("file", receiptFile.file);
      const response = await fetch("/api/media", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error("Receipt upload failed");
      const asset = (await response.json()) as { id: string };
      uploaded = true;
      await submitReceipt.mutateAsync({
        orderId: currentOrder.id,
        receiptAssetId: asset.id,
      });
      clearReceiptFile();
    } catch {
      if (!uploaded) toast.error(t("receiptUploadFailed"));
    } finally {
      setIsUploading(false);
    }
  };
  const openReview = (order: Order) => {
    setSelected(order);
    setReviewNote(order.reviewNote ?? "");
  };
  const submitReview = (decision: Decision) => {
    if (!selected) return;
    reviewOrder.mutate({ orderId: selected.id, decision, reviewNote });
  };
  const canGoNext = offset + PAGE_SIZE < data.totalSize;

  return (
    <SectionGroup>
      <SectionHeaderRow>
        <SectionHeader>
          <SectionTitle>{t("title")}</SectionTitle>
          <SectionDescription>
            {isAdmin ? t("adminDescription") : t("description")}
          </SectionDescription>
        </SectionHeader>
        {isAdmin ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/verification/review">
              <ShieldCheck />
              {t("reviewVerification")}
            </Link>
          </Button>
        ) : null}
      </SectionHeaderRow>

      {!isAdmin ? (
        <Section>
          <div className="rounded-lg border p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">{t("permanentListing")}</h2>
                  <Badge variant="secondary">{t("lifetime")}</Badge>
                </div>
                <p className="text-muted-foreground max-w-2xl text-sm">
                  {t("permanentListingDescription")}
                </p>
                <p className="text-2xl font-semibold">¥99</p>
              </div>
              {access.verificationStatus === "verified" &&
              !isEnterpriseUpgrade ? (
                <Badge>{t("benefitActive")}</Badge>
              ) : canCreateOrRelink ? (
                <Button
                  type="button"
                  disabled={createOrder.isPending}
                  onClick={() => createOrder.mutate()}
                >
                  <ReceiptText />
                  {currentOrder ? t("relinkOrder") : t("createOrder")}
                </Button>
              ) : !pendingApplication ? (
                <Button asChild>
                  <Link href="/verification">
                    {verificationT("startApplication")}
                  </Link>
                </Button>
              ) : null}
            </div>

            {isEnterpriseUpgrade ? (
              <p className="bg-muted/50 text-muted-foreground mt-4 rounded-md px-3 py-2 text-sm">
                {t("upgradeNoPayment")}
              </p>
            ) : currentOrder && orderMatchesPendingApplication ? (
              <div className="mt-5 border-t pt-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1 text-sm">
                    <p className="font-medium">{currentOrder.orderNumber}</p>
                    <p className="text-muted-foreground">
                      {t("createdAt", {
                        date: formatDate(currentOrder.createdAt, locale),
                      })}
                    </p>
                  </div>
                  <Badge variant={statusVariant(currentOrder.status)}>
                    {t(`status.${currentOrder.status}`)}
                  </Badge>
                </div>
                {currentOrder.reviewNote ? (
                  <p className="text-destructive mt-3 text-sm">
                    {currentOrder.reviewNote}
                  </p>
                ) : null}
                {currentOrder.receiptUrl ? (
                  <Button asChild variant="link" className="mt-2 h-auto p-0">
                    <a
                      href={currentOrder.receiptUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("viewReceipt")}
                    </a>
                  </Button>
                ) : null}
              </div>
            ) : null}

            {canUploadReceipt ? (
              <div className="mt-5 space-y-3 border-t pt-4">
                <div>
                  <p className="text-sm font-medium">{t("uploadReceipt")}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t("paymentInstructions")}
                  </p>
                </div>
                <input
                  ref={receiptInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  disabled={isUploading || submitReceipt.isPending}
                  onChange={(event) => {
                    selectReceipt(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />
                {!receiptFile ? (
                  <button
                    type="button"
                    className="border-muted-foreground/30 hover:bg-muted/40 focus-visible:ring-ring flex w-full items-center gap-3 rounded-md border border-dashed px-3 py-4 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
                    onClick={() => receiptInputRef.current?.click()}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      selectReceipt(Array.from(event.dataTransfer.files));
                    }}
                    onPaste={(event) => {
                      const files = Array.from(
                        event.clipboardData.items,
                      ).flatMap((item) => {
                        if (item.kind !== "file") return [];
                        const file = item.getAsFile();
                        return file ? [file] : [];
                      });
                      if (files.length) {
                        event.preventDefault();
                        selectReceipt(files);
                      }
                    }}
                  >
                    <ImagePlus className="text-muted-foreground size-5 shrink-0" />
                    <span>
                      <span className="block text-sm font-medium">
                        {t("selectReceipt")}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {t("receiptDropHelp")}
                      </span>
                    </span>
                  </button>
                ) : (
                  <div className="flex items-center gap-3 rounded-md border p-3">
                    <div className="relative size-20 shrink-0 overflow-hidden rounded-md border">
                      <Image
                        src={receiptFile.previewUrl}
                        alt={t("receiptPreview")}
                        fill
                        sizes="80px"
                        unoptimized
                        className="object-cover"
                      />
                    </div>
                    <p className="min-w-0 flex-1 truncate text-sm">
                      {receiptFile.file.name}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title={t("removeReceipt")}
                      onClick={clearReceiptFile}
                    >
                      <X />
                    </Button>
                  </div>
                )}
                <Button
                  type="button"
                  disabled={
                    !receiptFile || isUploading || submitReceipt.isPending
                  }
                  onClick={uploadReceipt}
                >
                  <ReceiptText />
                  {isUploading ? t("uploadingReceipt") : t("submitReceipt")}
                </Button>
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      <Section>
        <SectionHeader>
          <SectionTitle>
            {isAdmin ? t("reviewTitle") : t("historyTitle")}
          </SectionTitle>
          <SectionDescription>
            {isAdmin ? t("reviewDescription") : t("historyDescription")}
          </SectionDescription>
        </SectionHeader>

        {isAdmin ? (
          <Tabs
            value={filter}
            onValueChange={(value) => {
              setFilter(value as Filter);
              setOffset(0);
            }}
          >
            <TabsList>
              <TabsTrigger value="all">{t("filter.all")}</TabsTrigger>
              <TabsTrigger value="pending_review">
                {t("filter.pendingReview")}
              </TabsTrigger>
              <TabsTrigger value="paid">{t("filter.paid")}</TabsTrigger>
              <TabsTrigger value="active">{t("filter.active")}</TabsTrigger>
              <TabsTrigger value="rejected">{t("filter.rejected")}</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}

        {isLoading ? (
          <div className="text-muted-foreground py-12 text-center text-sm">
            {t("loading")}
          </div>
        ) : data.items.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("orderNumber")}</TableHead>
                  {isAdmin ? <TableHead>{t("user")}</TableHead> : null}
                  <TableHead>{t("type")}</TableHead>
                  <TableHead>{t("amount")}</TableHead>
                  <TableHead>{t("statusLabel")}</TableHead>
                  <TableHead>{t("submittedAt")}</TableHead>
                  {isAdmin ? (
                    <TableHead className="text-right">{t("action")}</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-mono text-xs">
                      {order.orderNumber}
                    </TableCell>
                    {isAdmin ? (
                      <TableCell>
                        <p className="font-medium">
                          {order.user.name || order.user.email}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {order.user.email}
                        </p>
                      </TableCell>
                    ) : null}
                    <TableCell>{t(`typeValue.${order.type}`)}</TableCell>
                    <TableCell>
                      {formatAmount(order.amountCents, order.currency, locale)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(order.status)}>
                        {t(`status.${order.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {formatDate(order.submittedAt ?? order.createdAt, locale)}
                    </TableCell>
                    {isAdmin ? (
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title={t("viewOrder")}
                          onClick={() => openReview(order)}
                        >
                          <Eye />
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="text-muted-foreground rounded-lg border border-dashed py-12 text-center text-sm">
            {t("empty")}
          </div>
        )}

        {data.totalSize > PAGE_SIZE ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs">
              {t("orderCount", { count: data.totalSize })}
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
        ) : null}
      </Section>

      <Section>
        <SectionHeader>
          <SectionTitle>{t("plannedTitle")}</SectionTitle>
          <SectionDescription>{t("plannedDescription")}</SectionDescription>
        </SectionHeader>
        <div className="divide-y rounded-lg border">
          <div className="flex items-center justify-between gap-4 p-4">
            <div>
              <p className="text-sm font-medium">{t("sponsoredSlot")}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {t("sponsoredSlotDescription")}
              </p>
            </div>
            <Badge variant="outline">{t("planned")}</Badge>
          </div>
          <div className="flex items-center justify-between gap-4 p-4">
            <div>
              <p className="text-sm font-medium">{t("proSubscription")}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {t("proSubscriptionDescription")}
              </p>
            </div>
            <Badge variant="outline">{t("planned")}</Badge>
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
            <DialogTitle>{t("orderDetail")}</DialogTitle>
            <DialogDescription>{selected?.orderNumber ?? ""}</DialogDescription>
          </DialogHeader>
          {selected ? (
            <div className="space-y-5">
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground text-xs">{t("user")}</dt>
                  <dd className="mt-1 font-medium">
                    {selected.user.name || selected.user.email}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">
                    {t("amount")}
                  </dt>
                  <dd className="mt-1 font-medium">
                    {formatAmount(
                      selected.amountCents,
                      selected.currency,
                      locale,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">
                    {t("verificationType")}
                  </dt>
                  <dd className="mt-1 font-medium">
                    {selected.application
                      ? verificationT(selected.application.type)
                      : "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">
                    {t("verificationStatus")}
                  </dt>
                  <dd className="mt-1 font-medium">
                    {selected.application
                      ? verificationT(
                          `applicationStatus.${selected.application.status}`,
                        )
                      : "-"}
                  </dd>
                </div>
              </dl>

              <div className="space-y-2">
                <Label>{t("paymentReceipt")}</Label>
                {selected.receiptUrl ? (
                  <a
                    href={selected.receiptUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="relative block aspect-video overflow-hidden rounded-md border"
                  >
                    <Image
                      src={selected.receiptUrl}
                      alt={t("receiptPreview")}
                      fill
                      sizes="640px"
                      unoptimized
                      className="object-contain"
                    />
                  </a>
                ) : (
                  <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
                    {t("noReceipt")}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="order-review-note">{t("reviewNote")}</Label>
                <Textarea
                  id="order-review-note"
                  className="min-h-24 resize-y"
                  value={reviewNote}
                  placeholder={t("reviewNotePlaceholder")}
                  disabled={selected.status !== "pending_review"}
                  onChange={(event) => setReviewNote(event.target.value)}
                />
              </div>

              {selected.status === "paid" ? (
                <p className="bg-muted/50 text-muted-foreground rounded-md px-3 py-2 text-xs">
                  {t("waitingVerificationApproval")}
                </p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            {selected?.status === "pending_review" ? (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={!reviewNote.trim() || reviewOrder.isPending}
                  onClick={() => submitReview("rejected")}
                >
                  <XCircle />
                  {t("rejectPayment")}
                </Button>
                <Button
                  type="button"
                  disabled={reviewOrder.isPending}
                  onClick={() => submitReview("approved")}
                >
                  <CheckCircle2 />
                  {t("confirmPayment")}
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
