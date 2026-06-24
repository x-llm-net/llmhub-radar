"use client";

import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { useChatSessionContext } from "@/components/chat/chat-session-context";
import type { SidebarMetadataProps } from "@/components/nav/sidebar-metadata";
import { SidebarRight } from "@/components/nav/sidebar-right";
import { useTRPC } from "@/lib/trpc/client";

export function Sidebar() {
  const t = useTranslations("chat");
  const router = useRouter();
  const { sessionId: activeId } = useChatSessionContext();

  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: sessions } = useQuery(trpc.chatSession.list.queryOptions());
  const { data: activeSession } = useQuery(
    trpc.chatSession.get.queryOptions(
      activeId !== undefined ? { sessionId: activeId } : skipToken,
    ),
  );

  const deleteMutation = useMutation(
    trpc.chatSession.delete.mutationOptions({
      onSuccess: (_, variables) => {
        queryClient.invalidateQueries({
          queryKey: trpc.chatSession.list.queryKey(),
        });
        if (variables.sessionId === activeId) router.push("/chat");
      },
    }),
  );

  const metadata: SidebarMetadataProps[] = [];
  if (activeSession) {
    metadata.push({
      label: t("details"),
      items: [
        { label: t("title"), value: activeSession.title },
        {
          label: t("created"),
          value: formatDistanceToNow(activeSession.createdAt, {
            addSuffix: true,
          }),
        },
        {
          label: t("updated"),
          value: formatDistanceToNow(activeSession.updatedAt, {
            addSuffix: true,
          }),
        },
      ],
    });
  }
  metadata.push({
    label: t("recent"),
    type: "list",
    items: (sessions ?? []).map((s) => ({
      id: s.id,
      label: s.title,
      meta: formatDistanceToNow(s.updatedAt, { addSuffix: true }),
      href: `/chat/${s.id}`,
      active: s.id === activeId,
      actions: [],
      deleteAction: {
        submitAction: async () => {
          await deleteMutation.mutateAsync({ sessionId: s.id });
        },
      },
    })),
  });

  return (
    <SidebarRight
      header={t("conversations")}
      metadata={metadata}
      footerButton={{
        onClick: () => router.push("/chat"),
        children: (
          <>
            <Plus />
            <span>{t("newChat")}</span>
          </>
        ),
      }}
    />
  );
}
