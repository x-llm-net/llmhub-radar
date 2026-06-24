"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";

import { ChatConversation } from "./chat-conversation";
import { ChatErrorBanner } from "./chat-error-banner";
import { ChatErrorBoundary } from "./chat-error-boundary";
import { ChatHistory } from "./chat-history";
import { ChatPromptInput } from "./chat-prompt-input";
import { ChatSuggestions } from "./chat-suggestions";
import {
  type ChatToolContextValue,
  ChatToolProvider,
} from "./chat-tool-context";
import { useChatSession } from "./use-chat-session";

export function ChatNewClient() {
  const t = useTranslations("chat.tool");
  const {
    messages,
    sendMessage,
    status,
    error,
    addToolApprovalResponse,
    stop,
  } = useChatSession({ sessionId: undefined });

  const onSubmit = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      sendMessage({ text });
    },
    [sendMessage],
  );

  const tool = useMemo<ChatToolContextValue>(
    () => ({
      confirmTool: (approvalId) =>
        addToolApprovalResponse({ id: approvalId, approved: true }),
      cancelTool: (approvalId, reason = t("cancelledByUser")) =>
        addToolApprovalResponse({
          id: approvalId,
          approved: false,
          reason,
        }),
    }),
    [addToolApprovalResponse, t],
  );

  return (
    <ChatToolProvider value={tool}>
      <div className="flex min-h-[calc(100svh-3.5rem)] flex-col">
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-10 p-6">
            <ChatSuggestions onSelect={onSubmit} />
            <ChatHistory />
          </div>
        ) : (
          <ChatErrorBoundary message={t("renderFailed")}>
            <ChatConversation messages={messages} status={status} />
          </ChatErrorBoundary>
        )}
        {error ? <ChatErrorBanner error={error} /> : null}
        <ChatPromptInput onSubmit={onSubmit} status={status} onStop={stop} />
      </div>
    </ChatToolProvider>
  );
}
