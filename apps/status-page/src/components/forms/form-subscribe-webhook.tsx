"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { RouterOutputs } from "@openstatus/api";
import { Checkbox } from "@openstatus/ui/components/ui/checkbox";
import { Form } from "@openstatus/ui/components/ui/form";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@openstatus/ui/components/ui/form";
import { Input } from "@openstatus/ui/components/ui/input";
import { cn } from "@openstatus/ui/lib/utils";
import { isTRPCClientError } from "@trpc/client";
import { useExtracted, useLocale } from "next-intl";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

type Page = NonNullable<RouterOutputs["statusPage"]["get"]>;

const schema = z.object({
  webhookUrl: z.url(),
  subscribeComponents: z.boolean(),
  pageComponents: z.array(z.number().int().positive()),
});

export type FormSubscribeWebhookValues = z.infer<typeof schema>;

export function FormSubscribeWebhook({
  page,
  onSubmit,
  className,
  ...props
}: Omit<React.ComponentProps<"form">, "onSubmit"> & {
  onSubmit: (values: FormSubscribeWebhookValues) => Promise<void>;
  page?: Page | null;
}) {
  const t = useExtracted();
  const locale = useLocale();
  const trackers = page?.trackers ?? [];
  const hasComponentSubscriptions = trackers.length > 0;
  const componentSubscriptionLabel = page?.radar
    ? locale === "zh"
      ? "订阅指定 API 密钥"
      : "Subscribe to specific API keys"
    : t("Subscribe to specific components");
  const form = useForm<FormSubscribeWebhookValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      webhookUrl: "",
      subscribeComponents: false,
      pageComponents: [],
    },
  });
  const [isPending, startTransition] = useTransition();

  function submitAction(values: FormSubscribeWebhookValues) {
    if (isPending) return;

    startTransition(async () => {
      try {
        const promise = onSubmit(values);
        toast.promise(promise, {
          loading: t("Subscribing..."),
          success: t("Webhook subscribed"),
          error: (error) => {
            if (isTRPCClientError(error)) {
              return error.message;
            }
            return t("Failed to subscribe");
          },
        });
        await promise;
      } catch (error) {
        console.error(error);
      }
    });
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(submitAction)}
        className={cn("flex flex-col gap-2", className)}
        {...props}
      >
        <FormField
          control={form.control}
          name="webhookUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="sr-only">{t("Webhook URL")}</FormLabel>
              <FormControl>
                <Input
                  placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
                  {...field}
                />
              </FormControl>
            </FormItem>
          )}
        />

        {hasComponentSubscriptions ? (
          <FormField
            control={form.control}
            name="subscribeComponents"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <FormLabel>{componentSubscriptionLabel}</FormLabel>
              </FormItem>
            )}
          />
        ) : null}
        {hasComponentSubscriptions && form.watch("subscribeComponents") && (
          <div className="border-border bg-muted flex max-h-56 flex-col gap-2 overflow-y-auto rounded-md border p-2">
            {trackers.map((tracker) => {
              if (tracker.type === "group") {
                const groupIds = tracker.components.map((c) => c.id);
                return (
                  <div key={tracker.groupId} className="flex flex-col gap-2">
                    <FormField
                      control={form.control}
                      name="pageComponents"
                      render={({ field }) => {
                        const allChecked = groupIds.every((id) =>
                          field.value?.includes(id),
                        );
                        const someChecked = groupIds.some((id) =>
                          field.value?.includes(id),
                        );
                        return (
                          <FormItem className="flex items-center gap-2">
                            <FormControl>
                              <Checkbox
                                checked={
                                  allChecked
                                    ? true
                                    : someChecked
                                      ? "indeterminate"
                                      : false
                                }
                                onCheckedChange={(checked) => {
                                  const value = field.value ?? [];
                                  if (checked) {
                                    field.onChange([
                                      ...new Set([...value, ...groupIds]),
                                    ]);
                                  } else {
                                    field.onChange(
                                      value.filter(
                                        (id) => !groupIds.includes(id),
                                      ),
                                    );
                                  }
                                }}
                              />
                            </FormControl>
                            <FormLabel>{tracker.groupName}</FormLabel>
                          </FormItem>
                        );
                      }}
                    />
                    {tracker.components.map((component) => (
                      <FormField
                        key={component.id}
                        control={form.control}
                        name="pageComponents"
                        render={({ field }) => (
                          <FormItem className="flex items-center gap-2 pl-6">
                            <FormControl>
                              <Checkbox
                                checked={field.value?.includes(component.id)}
                                onCheckedChange={(checked) => {
                                  const value = field.value ?? [];
                                  if (checked) {
                                    field.onChange([...value, component.id]);
                                  } else {
                                    field.onChange(
                                      value.filter((id) => id !== component.id),
                                    );
                                  }
                                }}
                              />
                            </FormControl>
                            <FormLabel>{component.name}</FormLabel>
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                );
              }
              return (
                <FormField
                  key={tracker.component.id}
                  control={form.control}
                  name="pageComponents"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value?.includes(tracker.component.id)}
                          onCheckedChange={(checked) => {
                            const value = field.value ?? [];
                            if (checked) {
                              field.onChange([...value, tracker.component.id]);
                            } else {
                              field.onChange(
                                value.filter(
                                  (id) => id !== tracker.component.id,
                                ),
                              );
                            }
                          }}
                        />
                      </FormControl>
                      <FormLabel>{tracker.component.name}</FormLabel>
                    </FormItem>
                  )}
                />
              );
            })}
          </div>
        )}
      </form>
    </Form>
  );
}
