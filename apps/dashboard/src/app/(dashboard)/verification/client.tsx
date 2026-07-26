"use client";

import { Badge } from "@openstatus/ui/components/ui/badge";
import { Button } from "@openstatus/ui/components/ui/button";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@openstatus/ui/components/ui/tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Building2,
  Check,
  ShieldCheck,
  UserRound,
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

type ApplicationType = "personal" | "enterprise";

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
  const locale = useLocale();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery(
    trpc.radar.verificationOverview.queryOptions(),
  );
  const [type, setType] = useState<ApplicationType>("personal");
  const [realName, setRealName] = useState("");
  const [personalIdentityNumber, setPersonalIdentityNumber] = useState("");
  const [mobile, setMobile] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [creditCode, setCreditCode] = useState("");
  const [legalRepresentativeName, setLegalRepresentativeName] = useState("");
  const [enterpriseIdentityNumber, setEnterpriseIdentityNumber] = useState("");

  const submit = useMutation(
    trpc.radar.submitVerification.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(
          trpc.radar.verificationOverview.queryOptions(),
        );
        toast.success(t("submitted"));
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (isLoading || !data) return null;

  const { access, activeVerificationType, applications } = data;
  const hasPending = applications.some(
    (application) => application.status === "pending",
  );
  const canUpgradeToEnterprise =
    !access.isAdmin &&
    access.verificationStatus === "verified" &&
    activeVerificationType === "personal" &&
    !hasPending;
  const canSubmitInitialApplication =
    !access.isAdmin && access.verificationStatus !== "verified" && !hasPending;
  const canApply = canSubmitInitialApplication || canUpgradeToEnterprise;
  const statusKey = access.isAdmin ? "admin" : access.verificationStatus;
  const statusVariant =
    statusKey === "verified" || statusKey === "admin"
      ? "default"
      : statusKey === "rejected"
        ? "destructive"
        : "secondary";
  const enterpriseFields = (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="verification-company-name">{t("companyName")}</Label>
        <Input
          id="verification-company-name"
          value={companyName}
          onChange={(event) => setCompanyName(event.target.value)}
          disabled={!canApply}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="verification-credit-code">{t("creditCode")}</Label>
        <Input
          id="verification-credit-code"
          value={creditCode}
          onChange={(event) => setCreditCode(event.target.value)}
          disabled={!canApply}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="verification-legal-name">
          {t("legalRepresentativeName")}
        </Label>
        <Input
          id="verification-legal-name"
          value={legalRepresentativeName}
          onChange={(event) => setLegalRepresentativeName(event.target.value)}
          required
        />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="verification-enterprise-identity">
          {t("legalRepresentativeIdentityNumber")}
        </Label>
        <Input
          id="verification-enterprise-identity"
          value={enterpriseIdentityNumber}
          onChange={(event) => setEnterpriseIdentityNumber(event.target.value)}
          autoComplete="off"
          required
        />
      </div>
    </div>
  );

  return (
    <SectionGroup>
      <SectionHeaderRow>
        <SectionHeader>
          <SectionTitle>{t("title")}</SectionTitle>
          <SectionDescription>{t("description")}</SectionDescription>
        </SectionHeader>
        {access.isAdmin ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/verification/review">
              <ShieldCheck />
              {t("reviewApplications")}
            </Link>
          </Button>
        ) : canApply ? (
          <Button asChild size="sm">
            <a href="#application">
              <BadgeCheck />
              {canUpgradeToEnterprise
                ? t("upgradeToEnterprise")
                : t("startApplication")}
            </a>
          </Button>
        ) : null}
      </SectionHeaderRow>

      <Section>
        <div className="bg-card grid overflow-hidden rounded-lg border sm:grid-cols-3">
          <div className="space-y-2 p-4 sm:border-r">
            <p className="text-muted-foreground text-xs font-medium">
              {t("currentStatus")}
            </p>
            <Badge variant={statusVariant}>{t(`status.${statusKey}`)}</Badge>
          </div>
          <div className="space-y-2 border-t p-4 sm:border-t-0 sm:border-r">
            <p className="text-muted-foreground text-xs font-medium">
              {t("providerQuota")}
            </p>
            <p className="text-lg font-semibold">
              {access.providerLimit == null
                ? t("unlimited")
                : `${access.providerUsage}/${access.providerLimit}`}
            </p>
          </div>
          <div className="space-y-2 border-t p-4 sm:border-t-0">
            <p className="text-muted-foreground text-xs font-medium">
              {t("certificationFee")}
            </p>
            <p className="text-lg font-semibold">{t("feeValue")}</p>
          </div>
        </div>
      </Section>

      <Section>
        <SectionHeader>
          <SectionTitle>{t("benefitsTitle")}</SectionTitle>
          <SectionDescription>{t("benefitsDescription")}</SectionDescription>
        </SectionHeader>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("benefit")}</TableHead>
                <TableHead>{t("standard")}</TableHead>
                <TableHead>{t("verified")}</TableHead>
                <TableHead>
                  {t("pro")}
                  <Badge className="ml-2" variant="outline">
                    {t("planned")}
                  </Badge>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>{t("providerLimit")}</TableCell>
                <TableCell>1</TableCell>
                <TableCell className="font-medium">3</TableCell>
                <TableCell>10</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>{t("claimProvider")}</TableCell>
                <TableCell>-</TableCell>
                <TableCell>
                  <Check className="size-4" />
                </TableCell>
                <TableCell>
                  <Check className="size-4" />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>{t("verifiedIdentity")}</TableCell>
                <TableCell>-</TableCell>
                <TableCell>
                  <Check className="size-4" />
                </TableCell>
                <TableCell>
                  <Check className="size-4" />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>{t("rankingImpact")}</TableCell>
                <TableCell colSpan={3}>{t("noRankingImpact")}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </Section>

      {canApply && (
        <Section id="application">
          <SectionHeader>
            <SectionTitle>
              {canUpgradeToEnterprise
                ? t("upgradeApplicationTitle")
                : t("applicationTitle")}
            </SectionTitle>
            <SectionDescription>
              {canUpgradeToEnterprise
                ? t("upgradeApplicationDescription")
                : t("applicationDescription")}
            </SectionDescription>
          </SectionHeader>

          <form
            className="bg-card space-y-6 rounded-lg border p-5"
            onSubmit={(event) => {
              event.preventDefault();
              submit.mutate(
                !canUpgradeToEnterprise && type === "personal"
                  ? {
                      type,
                      realName,
                      identityNumber: personalIdentityNumber,
                      mobile,
                    }
                  : {
                      type: "enterprise",
                      companyName,
                      creditCode,
                      legalRepresentativeName,
                      identityNumber: enterpriseIdentityNumber,
                    },
              );
            }}
          >
            {canUpgradeToEnterprise ? (
              enterpriseFields
            ) : (
              <Tabs
                value={type}
                onValueChange={(value) => setType(value as ApplicationType)}
              >
                <TabsList className="grid w-full grid-cols-2 sm:w-[420px]">
                  <TabsTrigger value="personal">
                    <UserRound />
                    {t("personal")}
                  </TabsTrigger>
                  <TabsTrigger value="enterprise">
                    <Building2 />
                    {t("enterprise")}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="personal" className="mt-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="verification-real-name">
                        {t("realName")}
                      </Label>
                      <Input
                        id="verification-real-name"
                        value={realName}
                        onChange={(event) => setRealName(event.target.value)}
                        autoComplete="name"
                        required={type === "personal"}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="verification-mobile">{t("mobile")}</Label>
                      <Input
                        id="verification-mobile"
                        inputMode="numeric"
                        value={mobile}
                        onChange={(event) => setMobile(event.target.value)}
                        autoComplete="tel"
                        required={type === "personal"}
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="verification-personal-identity">
                        {t("identityNumber")}
                      </Label>
                      <Input
                        id="verification-personal-identity"
                        value={personalIdentityNumber}
                        onChange={(event) =>
                          setPersonalIdentityNumber(event.target.value)
                        }
                        autoComplete="off"
                        required={type === "personal"}
                      />
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="enterprise" className="mt-5">
                  {enterpriseFields}
                </TabsContent>
              </Tabs>
            )}

            <p className="bg-muted/50 text-muted-foreground rounded-md px-3 py-2 text-xs">
              {t("sensitiveDataNotice")}
            </p>

            <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-muted-foreground max-w-xl text-xs">
                {canUpgradeToEnterprise
                  ? t("upgradeFeeNotice")
                  : t("feeNotice")}
              </p>
              <Button type="submit" disabled={!canApply || submit.isPending}>
                <BadgeCheck />
                {submit.isPending
                  ? t("submitting")
                  : canUpgradeToEnterprise
                    ? t("submitUpgrade")
                    : t("submit")}
              </Button>
            </div>
          </form>
        </Section>
      )}

      <Section>
        <SectionHeader>
          <SectionTitle>{t("historyTitle")}</SectionTitle>
          <SectionDescription>{t("historyDescription")}</SectionDescription>
        </SectionHeader>
        {applications.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
            {t("emptyHistory")}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("type")}</TableHead>
                  <TableHead>{t("submittedAt")}</TableHead>
                  <TableHead>{t("statusLabel")}</TableHead>
                  <TableHead>{t("reviewNote")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((application) => (
                  <TableRow key={application.id}>
                    <TableCell>{t(application.type)}</TableCell>
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
                    <TableCell className="max-w-72 whitespace-normal">
                      {application.reviewNote || "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </SectionGroup>
  );
}
