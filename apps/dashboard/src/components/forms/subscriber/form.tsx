"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { detectWebhookFlavor } from "@openstatus/subscriptions/client";
import { Button } from "@openstatus/ui/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@openstatus/ui/components/ui/form";
import { Input } from "@openstatus/ui/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@openstatus/ui/components/ui/tabs";
import { cn } from "@openstatus/ui/lib/utils";
import { isTRPCClientError } from "@trpc/client";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useTransition } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  EmptyStateContainer,
  EmptyStateTitle,
} from "@/components/content/empty-state";
import {
  FormCardContent,
  FormCardSeparator,
} from "@/components/forms/form-card";
import { useFormSheetDirty } from "@/components/forms/form-sheet";
import {
  CheckboxTree,
  type CheckboxTreeItem,
} from "@/components/ui/checkbox-tree";

// Form schema: a single flat shape with optional fields. The submit handler
// narrows to email-only or webhook-only payload based on `channelType`.
function getFormSchema(t: (key: string) => string) {
  const headerSchema = z.object({
    key: z.string().min(1, t("keyRequired")),
    value: z.string(),
  });

  return z
  .object({
    channelType: z.enum(["email", "webhook"]),
    name: z.string().max(255),
    email: z.string(),
    webhookUrl: z.string(),
    headers: z.array(headerSchema),
    componentIds: z.array(z.number()),
  })
  .superRefine((data, ctx) => {
    if (data.channelType === "email") {
      const result = z.email().safeParse(data.email);
      if (!result.success) {
        ctx.addIssue({
          code: "custom",
          path: ["email"],
          message: t("invalidEmail"),
        });
      }
    } else {
      const result = z.url().safeParse(data.webhookUrl);
      if (!result.success) {
        ctx.addIssue({
          code: "custom",
          path: ["webhookUrl"],
          message: t("invalidUrl"),
        });
      } else if (detectWebhookFlavor(data.webhookUrl) === "generic") {
        ctx.addIssue({
          code: "custom",
          path: ["webhookUrl"],
          message: t("unsupportedWebhook"),
        });
      }
    }
  });
}

export type SubscriberFormValues = z.infer<ReturnType<typeof getFormSchema>>;

export type SubmitPayload =
  | {
      channelType: "email";
      name: string;
      email: string;
      componentIds: number[];
    }
  | {
      channelType: "webhook";
      name: string;
      webhookUrl: string;
      headers: { key: string; value: string }[];
      componentIds: number[];
    };

function toPayload(values: SubscriberFormValues): SubmitPayload {
  if (values.channelType === "email") {
    return {
      channelType: "email",
      name: values.name,
      email: values.email,
      componentIds: values.componentIds,
    };
  }
  return {
    channelType: "webhook",
    name: values.name,
    webhookUrl: values.webhookUrl,
    headers: values.headers,
    componentIds: values.componentIds,
  };
}

const emptyDefaults: SubscriberFormValues = {
  channelType: "email",
  name: "",
  email: "",
  webhookUrl: "",
  headers: [],
  componentIds: [],
};

export function FormSubscriber({
  defaultValues,
  onSubmit,
  className,
  items,
  editMode = false,
  ...props
}: Omit<React.ComponentProps<"form">, "onSubmit"> & {
  defaultValues?: Partial<SubscriberFormValues>;
  items: CheckboxTreeItem[];
  onSubmit: (values: SubmitPayload) => Promise<void>;
  /** When true, channel type is locked (editing an existing subscriber). */
  editMode?: boolean;
}) {
  const t = useTranslations("statusPages.subscribers");
  const form = useForm<SubscriberFormValues>({
    resolver: zodResolver(getFormSchema(t)),
    defaultValues: { ...emptyDefaults, ...defaultValues },
  });

  const channelType = form.watch("channelType");
  const [isPending, startTransition] = useTransition();
  const { setIsDirty } = useFormSheetDirty();

  const formIsDirty = form.formState.isDirty;
  React.useEffect(() => {
    setIsDirty(formIsDirty);
  }, [formIsDirty, setIsDirty]);

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "headers",
  });

  function submitAction(values: SubscriberFormValues) {
    if (isPending) return;

    startTransition(async () => {
      try {
        const promise = onSubmit(toPayload(values));
        toast.promise(promise, {
          loading: t("saving"),
          success: () => t("saved"),
          error: (error) => {
            if (isTRPCClientError(error)) {
              return error.message;
            }
            return t("failedToSave");
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
        className={cn("grid gap-4", className)}
        onSubmit={form.handleSubmit(submitAction)}
        {...props}
      >
        <FormCardContent>
          <FormField
            control={form.control}
            name="channelType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("channel")}</FormLabel>
                <FormControl>
                  <Tabs
                    value={field.value}
                    onValueChange={(v) => {
                      if (editMode) return;
                      if (v === "email" || v === "webhook") {
                        field.onChange(v);
                      }
                    }}
                  >
                    <TabsList>
                      <TabsTrigger value="email" disabled={editMode}>
                        {t("email")}
                      </TabsTrigger>
                      <TabsTrigger value="webhook" disabled={editMode}>
                        {t("webhook")}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormCardContent>
        <FormCardSeparator />
        <FormCardContent>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("displayLabel")}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={
                      channelType === "webhook"
                        ? t("webhookNamePlaceholder")
                        : t("emailNamePlaceholder")
                    }
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t("displayLabelDescription")}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormCardContent>
        <FormCardSeparator />
        {channelType === "email" ? (
          <FormCardContent>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("email")}</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder={t("emailPlaceholder")}
                      autoComplete="off"
                      readOnly={editMode}
                      {...field}
                    />
                  </FormControl>
                  {editMode ? (
                    <FormDescription>
                      {t("emailImmutable")}
                    </FormDescription>
                  ) : (
                    <FormDescription>
                      {t("emailConsent")}
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormCardContent>
        ) : (
          <>
            <FormCardContent>
              <FormField
                control={form.control}
                name="webhookUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("webhookUrl")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("webhookPlaceholder")}
                        autoComplete="off"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("webhookSupport")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormCardContent>
            <FormCardSeparator />
            <FormCardContent>
              <FormItem>
                <FormLabel>{t("requestHeaders")}</FormLabel>
                <FormDescription>
                  {t("requestHeadersDescription")}
                </FormDescription>
                {fields.map((f, idx) => (
                  <div key={f.id} className="grid gap-2 sm:grid-cols-5">
                    <FormField
                      control={form.control}
                      name={`headers.${idx}.key`}
                      render={({ field }) => (
                        <FormItem className="col-span-2">
                          <FormControl>
                            <Input placeholder={t("key")} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`headers.${idx}.value`}
                      render={({ field }) => (
                        <FormItem className="col-span-2">
                          <FormControl>
                            <Input placeholder={t("value")} {...field} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      type="button"
                      aria-label={t("removeHeader")}
                      onClick={() => remove(idx)}
                    >
                      <X />
                    </Button>
                  </div>
                ))}
                <div>
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={() => append({ key: "", value: "" })}
                  >
                    <Plus />
                    {t("addHeader")}
                  </Button>
                </div>
                <FormMessage />
              </FormItem>
            </FormCardContent>
          </>
        )}
        <FormCardSeparator />
        <FormCardContent>
          <FormField
            control={form.control}
            name="componentIds"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("pageComponents")}</FormLabel>
                <FormDescription>
                  {t("pageComponentsDescription")}
                </FormDescription>
                {items.length ? (
                  <FormControl>
                    <CheckboxTree
                      items={items}
                      value={field.value ?? []}
                      onValueChange={field.onChange}
                    />
                  </FormControl>
                ) : (
                  <EmptyStateContainer>
                    <EmptyStateTitle>{t("noPageComponents")}</EmptyStateTitle>
                  </EmptyStateContainer>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
        </FormCardContent>
      </form>
    </Form>
  );
}
