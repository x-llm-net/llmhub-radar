"use client";

import type { RouterOutputs } from "@openstatus/api";
import {
  StatusUpdates as BlockStatusUpdates,
  StatusUpdatesContent,
  StatusUpdatesJson,
  StatusUpdatesRss,
  StatusUpdatesSection,
  StatusUpdatesSlack,
  StatusUpdatesSsh,
  StatusUpdatesTrigger,
} from "@openstatus/ui/components/blocks/status-updates";
import { Button } from "@openstatus/ui/components/ui/button";
import { Input } from "@openstatus/ui/components/ui/input";
import { Separator } from "@openstatus/ui/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@openstatus/ui/components/ui/tabs";
import { useCookieState } from "@openstatus/ui/hooks/use-cookie-state";
import { cn } from "@openstatus/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { useExtracted, useLocale } from "next-intl";
import { useParams } from "next/navigation";
import { useState } from "react";

import {
  FormSubscribeEmail,
  type FormValues,
} from "@/components/forms/form-subscribe-email";
import {
  FormSubscribeWebhook,
  type FormSubscribeWebhookValues,
} from "@/components/forms/form-subscribe-webhook";
import { getBaseUrl } from "@/lib/base-url";
import { createProtectedCookieKey } from "@/lib/protected";
import { useTRPC } from "@/lib/trpc/client";

export type StatusUpdateType =
  | "email"
  | "webhook"
  | "rss"
  | "ssh"
  | "json"
  | "slack";

type Page = NonNullable<RouterOutputs["statusPage"]["get"]>;

function getUpdateLink(
  type: "rss" | "json" | "atom",
  page?: Page | null,
  password?: string,
) {
  const baseUrl = getBaseUrl({
    slug: page?.slug,
    customDomain: page?.customDomain,
  });

  return `${baseUrl}/feed/${type}${
    page?.accessType === "password" && password
      ? `?pw=${encodeURIComponent(password)}`
      : ""
  }`;
}

interface StatusUpdatesProps extends React.ComponentProps<typeof Button> {
  types?: StatusUpdateType[];
  page?: Page | null;
  onSubscribe?: (
    values:
      | ({ channelType: "email" } & FormValues)
      | ({ channelType: "webhook" } & FormSubscribeWebhookValues),
  ) => Promise<void> | void;
}

export function StatusUpdates({
  className,
  types = ["rss", "ssh", "json", "slack"],
  page,
  onSubscribe,
  ...props
}: StatusUpdatesProps) {
  const t = useExtracted();
  const trpc = useTRPC();
  const locale = useLocale();
  const [success, setSuccess] = useState<"email" | "manage" | "webhook" | null>(
    null,
  );
  const [manageEmail, setManageEmail] = useState("");
  const params = useParams();
  const domain = typeof params.domain === "string" ? params.domain : "";
  const [password] = useCookieState(createProtectedCookieKey(domain));
  const managementLinkMutation = useMutation(
    trpc.statusPage.sendSubscriptionManagementLink.mutationOptions({}),
  );

  if (types.length === 0) return null;

  const rssUrl = getUpdateLink("rss", page, password);
  const atomUrl = getUpdateLink("atom", page, password);
  const jsonUrl = getUpdateLink("json", page, password);
  const sshCommand = `ssh ${page?.slug}@ssh.openstatus.dev`;
  const canManageEmailSubscription =
    !!onSubscribe && types.includes("email") && !!page;

  async function requestManagementLink() {
    if (!page || !manageEmail || managementLinkMutation.isPending) return;

    try {
      await managementLinkMutation.mutateAsync({
        slug: domain,
        email: manageEmail,
        locale,
      });
      setSuccess("manage");
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <BlockStatusUpdates>
      <StatusUpdatesTrigger className={cn(className)} {...props} />
      <StatusUpdatesContent>
        <Tabs defaultValue={types[0]}>
          <TabsList className="w-full rounded-none border-b">
            {types.includes("email") ? (
              <TabsTrigger value="email">{t("Email")}</TabsTrigger>
            ) : null}
            {types.includes("webhook") ? (
              <TabsTrigger value="webhook">{t("Webhook")}</TabsTrigger>
            ) : null}
            {types.includes("slack") ? (
              <TabsTrigger value="slack">{t("Slack")}</TabsTrigger>
            ) : null}
            {types.includes("rss") ? (
              <TabsTrigger value="rss">{t("RSS")}</TabsTrigger>
            ) : null}
            {types.includes("json") ? (
              <TabsTrigger value="json">{t("JSON")}</TabsTrigger>
            ) : null}
            {types.includes("ssh") ? (
              <TabsTrigger value="ssh">{t("SSH")}</TabsTrigger>
            ) : null}
          </TabsList>
          <TabsContent value="email" className="flex flex-col gap-2">
            {success === "email" || success === "manage" ? (
              <SuccessMessage type={success} />
            ) : (
              <>
                <StatusUpdatesSection
                  description={t(
                    "Get email notifications whenever a report has been created or resolved",
                  )}
                  className="py-0 pt-2"
                >
                  <FormSubscribeEmail
                    id="email-form"
                    page={page}
                    onSubmit={async (values) => {
                      await onSubscribe?.({ channelType: "email", ...values });
                      setSuccess("email");
                    }}
                  />
                </StatusUpdatesSection>
                <Separator />
                <div className="px-2 pb-2">
                  <Button className="w-full" type="submit" form="email-form">
                    {t("Subscribe")}
                  </Button>
                </div>
                {canManageEmailSubscription ? (
                  <>
                    <Separator />
                    <StatusUpdatesSection
                      description={
                        locale === "zh"
                          ? "\u5df2\u7ecf\u8ba2\u9605\u8fc7\uff1f\u8f93\u5165\u90ae\u7bb1\uff0c\u6211\u4eec\u4f1a\u53d1\u9001\u7ba1\u7406\u94fe\u63a5\uff0c\u7528\u4e8e\u8c03\u6574\u901a\u77e5\u8303\u56f4\u6216\u53d6\u6d88\u8ba2\u9605\u3002"
                          : "Already subscribed? Enter your email and we will send a management link to update or unsubscribe."
                      }
                      className="py-0 pt-2"
                    >
                      <div className="flex flex-col gap-2">
                        <Input
                          type="email"
                          value={manageEmail}
                          placeholder="subscribe@me.com"
                          onChange={(event) =>
                            setManageEmail(event.target.value)
                          }
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          disabled={
                            !manageEmail || managementLinkMutation.isPending
                          }
                          onClick={requestManagementLink}
                        >
                          {managementLinkMutation.isPending
                            ? t("Submitting...")
                            : locale === "zh"
                              ? "\u53d1\u9001\u7ba1\u7406\u94fe\u63a5"
                              : "Send management link"}
                        </Button>
                      </div>
                    </StatusUpdatesSection>
                  </>
                ) : null}
              </>
            )}
          </TabsContent>
          <TabsContent value="webhook" className="flex flex-col gap-2">
            {success === "webhook" ? (
              <SuccessMessage type="webhook" />
            ) : (
              <>
                <StatusUpdatesSection
                  description={t(
                    "Send status updates to a webhook URL after a successful verification request.",
                  )}
                  className="py-0 pt-2"
                >
                  <FormSubscribeWebhook
                    id="webhook-form"
                    page={page}
                    onSubmit={async (values) => {
                      await onSubscribe?.({
                        channelType: "webhook",
                        ...values,
                      });
                      setSuccess("webhook");
                    }}
                  />
                </StatusUpdatesSection>
                <Separator />
                <div className="px-2 pb-2">
                  <Button className="w-full" type="submit" form="webhook-form">
                    {t("Subscribe")}
                  </Button>
                </div>
              </>
            )}
          </TabsContent>
          <TabsContent value="rss">
            <StatusUpdatesRss rssUrl={rssUrl} atomUrl={atomUrl} />
          </TabsContent>
          <TabsContent value="json">
            <StatusUpdatesJson url={jsonUrl} />
          </TabsContent>
          <TabsContent value="ssh">
            <StatusUpdatesSsh command={sshCommand} />
          </TabsContent>
          <TabsContent value="slack">
            <StatusUpdatesSlack rssUrl={rssUrl} />
          </TabsContent>
        </Tabs>
      </StatusUpdatesContent>
    </BlockStatusUpdates>
  );
}

function SuccessMessage({ type }: { type: "email" | "manage" | "webhook" }) {
  const t = useExtracted();
  const locale = useLocale();
  const isManage = type === "manage";

  return (
    <div className="flex flex-col items-center justify-center gap-1 p-3">
      <Inbox className="size-4 shrink-0" />
      <p className="text-center font-medium">
        {type === "webhook" ? t("Webhook subscribed") : t("Check your inbox!")}
      </p>
      <p className="text-muted-foreground text-center text-sm">
        {type === "webhook"
          ? t("A verification request was accepted by your webhook URL.")
          : isManage
            ? locale === "zh"
              ? "\u4f7f\u7528\u90ae\u4ef6\u4e2d\u7684\u94fe\u63a5\u7ba1\u7406\u901a\u77e5\u8303\u56f4\u6216\u53d6\u6d88\u8ba2\u9605\u3002"
              : "Use the link in your email to manage notification scope or unsubscribe."
            : t("Validate your email to receive updates and you are all set.")}
      </p>
    </div>
  );
}
