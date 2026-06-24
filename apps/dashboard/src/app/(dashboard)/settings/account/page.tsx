"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import { Input } from "@openstatus/ui/components/ui/input";
import { Label } from "@openstatus/ui/components/ui/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";

import { Link } from "@/components/common/link";
import {
  Section,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { FormAlertDialog } from "@/components/forms/form-alert-dialog";
import {
  FormCardDescription,
  FormCardFooterInfo,
  FormCardHeader,
  FormCardTitle,
  FormCardUpgrade,
} from "@/components/forms/form-card";
import {
  FormCard,
  FormCardContent,
  FormCardFooter,
} from "@/components/forms/form-card";
import { ThemeToggle } from "@/components/theme-toggle";
import { useTRPC } from "@/lib/trpc/client";

export default function Page() {
  const t = useTranslations("settings.account");
  const trpc = useTRPC();
  const { data: user } = useQuery(trpc.user.get.queryOptions());
  const { data: workspace } = useQuery(trpc.workspace.get.queryOptions());
  const { data: members } = useQuery(trpc.member.list.queryOptions());

  const deleteAccountMutation = useMutation(
    trpc.user.deleteAccount.mutationOptions(),
  );

  if (!user || !workspace || !members) return null;

  const isOwner = members.find((m) => m.user.id === user.id)?.role === "owner";
  const hasPaidPlan = !!workspace.plan && workspace.plan !== "free";
  const isDeleteDisabled = isOwner && hasPaidPlan;

  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>{t("title")}</SectionTitle>
        </SectionHeader>
        <FormCard>
          <FormCardUpgrade />
          <FormCardHeader>
            <FormCardTitle>{t("personalInformation")}</FormCardTitle>
            <FormCardDescription>
              {t("personalInformationDescription")}
            </FormCardDescription>
          </FormCardHeader>
          <FormCardContent>
            <form className="grid gap-4">
              <div className="grid gap-1.5">
                <Label>{t("name")}</Label>
                <Input defaultValue={user?.name ?? undefined} />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("email")}</Label>
                <Input defaultValue={user?.email ?? undefined} />
              </div>
            </form>
          </FormCardContent>
          <FormCardFooter className="[&>:last-child]:ml-0">
            <FormCardFooterInfo>
              {t("contactToChange")}
            </FormCardFooterInfo>
          </FormCardFooter>
        </FormCard>
        <FormCard>
          <FormCardHeader>
            <FormCardTitle>{t("appearance")}</FormCardTitle>
            <FormCardDescription>
              {t("appearanceDescription")}
            </FormCardDescription>
          </FormCardHeader>
          <FormCardContent className="pb-4">
            <ThemeToggle />
          </FormCardContent>
        </FormCard>
        <FormCard variant="destructive">
          <FormCardHeader>
            <FormCardTitle>{t("deleteAccount")}</FormCardTitle>
            <FormCardDescription>
              {t("deleteDescription")}
            </FormCardDescription>
          </FormCardHeader>
          {isDeleteDisabled ? (
            <FormCardContent>
              <p className="text-destructive text-sm">
                {t("cancelSubscriptionFirst")} {t("goTo")}{" "}
                <a
                  href="/settings/billing"
                  className="font-medium underline underline-offset-4"
                >
                  {t("billing")}
                </a>{" "}
                {t("manageSubscription")}
              </p>
            </FormCardContent>
          ) : null}
          <FormCardFooter variant="destructive">
            <FormCardFooterInfo>
              {t("needHelpPrefix")}{" "}
              <Link href="mailto:ping@openstatus.dev">ping@openstatus.dev</Link>
              .
            </FormCardFooterInfo>
            <FormAlertDialog
              confirmationValue={user.email || user.name || "delete-account"}
              submitAction={async () => {
                await deleteAccountMutation.mutateAsync();
                await signOut({ redirectTo: "/" });
              }}
            >
              <Button
                variant="destructive"
                size="sm"
                disabled={isDeleteDisabled}
              >
                {t("delete")}
              </Button>
            </FormAlertDialog>
          </FormCardFooter>
        </FormCard>
      </Section>
    </SectionGroup>
  );
}
