"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import { Input } from "@openstatus/ui/components/ui/input";
import { Label } from "@openstatus/ui/components/ui/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
} from "@/components/forms/form-card";
import {
  FormCard,
  FormCardContent,
  FormCardFooter,
} from "@/components/forms/form-card";
import { useTRPC } from "@/lib/trpc/client";

export default function Page() {
  const t = useTranslations("settings.account");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const { data: user } = useQuery(trpc.user.get.queryOptions());
  const { data: workspace } = useQuery(trpc.workspace.get.queryOptions());
  const { data: members } = useQuery(trpc.member.list.queryOptions());

  const deleteAccountMutation = useMutation(
    trpc.user.deleteAccount.mutationOptions(),
  );
  const updateProfileMutation = useMutation(
    trpc.user.updateProfile.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.user.get.queryKey(),
        });
        toast.success(t("profileSaved"));
      },
      onError: () => {
        toast.error(t("failedToSaveProfile"));
      },
    }),
  );

  useEffect(() => {
    if (user) setName(user.name ?? "");
  }, [user]);

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
          <FormCardHeader>
            <FormCardTitle>{t("personalInformation")}</FormCardTitle>
            <FormCardDescription>
              {t("personalInformationDescription")}
            </FormCardDescription>
          </FormCardHeader>
          <FormCardContent>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                const nextName = name.trim();
                if (!nextName) {
                  toast.error(t("nameRequired"));
                  return;
                }
                updateProfileMutation.mutate({ name: nextName });
              }}
            >
              <div className="grid gap-1.5">
                <Label>{t("name")}</Label>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("email")}</Label>
                <Input value={user?.email ?? ""} readOnly />
              </div>
              <div>
                <Button
                  size="sm"
                  type="submit"
                  disabled={
                    updateProfileMutation.isPending ||
                    name.trim() === (user.name ?? "")
                  }
                >
                  {updateProfileMutation.isPending
                    ? t("savingProfile")
                    : t("saveProfile")}
                </Button>
              </div>
            </form>
          </FormCardContent>
          <FormCardFooter className="[&>:last-child]:ml-0">
            <FormCardFooterInfo>
              {t("contactToChange")}
            </FormCardFooterInfo>
          </FormCardFooter>
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
                {t("cancelSubscriptionFirst")}
              </p>
            </FormCardContent>
          ) : null}
          <FormCardFooter variant="destructive">
            <FormCardFooterInfo>
              {t("needHelpPrefix")}{" "}
              <Link href="mailto:support@llm-hub.store">
                support@llm-hub.store
              </Link>
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
