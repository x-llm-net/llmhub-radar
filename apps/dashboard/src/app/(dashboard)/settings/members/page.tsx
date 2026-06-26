"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";

import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { FormMembers } from "@/components/forms/settings/form-members";
import { useTRPC } from "@/lib/trpc/client";

export default function Page() {
  const t = useTranslations("settings.members");
  const locale = useLocale();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const createInvitationMutation = useMutation(
    trpc.invitation.create.mutationOptions(),
  );
  const sendTeamInvitationMutation = useMutation(
    trpc.emailRouter.sendTeamInvitation.mutationOptions(),
  );

  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>{t("title")}</SectionTitle>
          <SectionDescription>{t("description")}</SectionDescription>
        </SectionHeader>
        <FormMembers
          locked={false}
          onCreate={async (values) => {
            const created = await createInvitationMutation.mutateAsync({
              email: values.email,
            });

            if (created?.id) {
              await sendTeamInvitationMutation.mutateAsync({
                id: created.id,
                baseUrl: `${window.location.origin}/invite`,
                locale,
              });
            }

            await Promise.all([
              queryClient.invalidateQueries({
                queryKey: trpc.invitation.list.queryKey(),
              }),
              queryClient.invalidateQueries({
                queryKey: trpc.member.list.queryKey(),
              }),
            ]);
          }}
        />
      </Section>
    </SectionGroup>
  );
}
