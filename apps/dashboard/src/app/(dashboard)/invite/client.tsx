"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { useTRPC } from "@/lib/trpc/client";

export function Client() {
  const t = useTranslations("invite");
  const trpc = useTRPC();
  const [isPending, startTransition] = useTransition();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const { data: user } = useQuery(trpc.user.get.queryOptions());
  const {
    data: invitation,
    error,
    isPending: isLoadingInvitation,
  } = useQuery({
    ...trpc.invitation.get.queryOptions({ token }),
    enabled: Boolean(token),
    retry: false,
  });
  const acceptInvitationMutation = useMutation(
    trpc.invitation.accept.mutationOptions({
      onSuccess: (workspace) => {
        if (!workspace) return;
        document.cookie = `workspace-slug=${workspace.slug}; path=/;`;
        window.location.href = "/overview";
      },
    }),
  );

  const switchAccount = () => {
    const redirectTo = `${window.location.pathname}${window.location.search}`;
    void signOut({
      redirectTo: `/login?redirectTo=${encodeURIComponent(redirectTo)}`,
    });
  };

  if (!token) {
    return (
      <InviteMessage
        title={t("missingTokenTitle")}
        description={t("missingTokenDescription")}
      />
    );
  }

  if (error) {
    const description = isTRPCClientError(error)
      ? t("invalidDescription")
      : t("failedToLoadDescription");

    return (
      <InviteMessage
        title={t("invalidTitle")}
        description={description}
        currentEmail={user?.email ?? undefined}
        action={
          <Button size="sm" variant="outline" onClick={switchAccount}>
            {t("switchAccount")}
          </Button>
        }
      />
    );
  }

  if (isLoadingInvitation) return null;
  if (!invitation) {
    return (
      <InviteMessage
        title={t("invalidTitle")}
        description={t("invalidDescription")}
        currentEmail={user?.email ?? undefined}
        action={
          <Button size="sm" variant="outline" onClick={switchAccount}>
            {t("switchAccount")}
          </Button>
        }
      />
    );
  }
  if (invitation.acceptedAt) {
    return (
      <InviteMessage
        title={t("alreadyAcceptedTitle")}
        description={t("alreadyAcceptedDescription")}
      />
    );
  }

  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>{t("title")}</SectionTitle>
          <SectionDescription>
            {t("descriptionPrefix")}{" "}
            <span className="font-semibold">
              {invitation.workspace.name || t("defaultWorkspaceName")}
            </span>
            {t("descriptionSuffix")}
          </SectionDescription>
        </SectionHeader>
        <Button
          size="sm"
          onClick={() => {
            startTransition(async () => {
              try {
                const promise = acceptInvitationMutation.mutateAsync({
                  id: invitation.id,
                });
                toast.promise(promise, {
                  loading: t("accepting"),
                  success: t("accepted"),
                  error: (error) => {
                    if (isTRPCClientError(error)) {
                      return error.message;
                    }
                    return t("failedToAccept");
                  },
                });
                await promise;
              } catch (error) {
                console.error(error);
              }
            });
          }}
        >
          {isPending ? t("acceptingShort") : t("accept")}
        </Button>
      </Section>
    </SectionGroup>
  );
}

function InviteMessage({
  title,
  description,
  currentEmail,
  action,
}: {
  title: string;
  description: string;
  currentEmail?: string;
  action?: React.ReactNode;
}) {
  const t = useTranslations("invite");

  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>{title}</SectionTitle>
          <SectionDescription>{description}</SectionDescription>
          {currentEmail ? (
            <SectionDescription>
              {t("signedInAs", { email: currentEmail })}
            </SectionDescription>
          ) : null}
        </SectionHeader>
        {action}
      </Section>
    </SectionGroup>
  );
}
