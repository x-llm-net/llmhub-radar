"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";

import { useChatSessionContext } from "@/components/chat/chat-session-context";
import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";
import { useTRPC } from "@/lib/trpc/client";

export function Breadcrumb() {
  const t = useTranslations("chat");
  // Context (not `useParams`) so we follow runtime `replaceState` URL swaps.
  const { sessionId } = useChatSessionContext();

  const trpc = useTRPC();
  const { data: session } = useQuery(
    trpc.chatSession.get.queryOptions(
      sessionId !== undefined ? { sessionId } : skipToken,
    ),
  );

  if (sessionId === undefined) {
    return (
      <NavBreadcrumb
        items={[{ type: "page", label: t("assistant"), icon: MessageSquare }]}
      />
    );
  }

  return (
    <NavBreadcrumb
      items={[
        {
          type: "link",
          label: t("assistant"),
          href: "/chat",
          icon: MessageSquare,
        },
        { type: "page", label: session?.title ?? t("newChat") },
      ]}
    />
  );
}
