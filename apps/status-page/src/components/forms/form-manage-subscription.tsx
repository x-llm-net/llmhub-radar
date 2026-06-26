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
import { Separator } from "@openstatus/ui/components/ui/separator";
import { cn } from "@openstatus/ui/lib/utils";
import { isTRPCClientError } from "@trpc/client";
import { useExtracted, useLocale } from "next-intl";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

type Page = NonNullable<RouterOutputs["statusPage"]["get"]>;

const schema = z.object({
  pageComponents: z.array(z.number().int().positive()),
  subscribeComponents: z.boolean(),
});

export type FormValues = z.infer<typeof schema>;

export function FormManageSubscription({
  page,
  defaultValues,
  onSubmit,
  className,
  ...props
}: Omit<React.ComponentProps<"form">, "onSubmit"> & {
  onSubmit: (values: FormValues) => Promise<void>;
  onSubmitCallback?: () => void;
  page?: Page | null;
  defaultValues?: FormValues;
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
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      pageComponents: defaultValues?.pageComponents ?? [],
      subscribeComponents: defaultValues?.subscribeComponents ?? true,
    },
  });
  const [isPending, startTransition] = useTransition();

  function submitAction(values: FormValues) {
    if (isPending) return;

    startTransition(async () => {
      try {
        const promise = onSubmit(values);
        toast.promise(promise, {
          loading: t("Updating subscription..."),
          success: t("Subscription updated"),
          error: (error) => {
            if (isTRPCClientError(error)) {
              return error.message;
            }
            return t("Failed to update subscription");
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
        {hasComponentSubscriptions ? (
          <FormField
            control={form.control}
            name="subscribeComponents"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2 px-4">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(checked) => {
                      field.onChange(checked);
                    }}
                  />
                </FormControl>
                <FormLabel>{componentSubscriptionLabel}</FormLabel>
              </FormItem>
            )}
          />
        ) : null}
        {hasComponentSubscriptions && form.watch("subscribeComponents") ? (
          <>
            <Separator className="my-2" />
            {trackers.map((tracker) => {
              if (tracker.type === "group") {
                const groupIds = tracker.components.map((c) => c.id);
                return (
                  <div
                    key={tracker.groupId}
                    className="flex flex-col gap-2 px-4"
                  >
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
                    <FormItem className="flex items-center gap-2 px-4">
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
          </>
        ) : null}
      </form>
    </Form>
  );
}
