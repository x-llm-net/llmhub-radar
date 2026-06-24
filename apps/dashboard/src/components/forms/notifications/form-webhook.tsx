"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@openstatus/ui/components/ui/button";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@openstatus/ui/components/ui/form";
import { Form } from "@openstatus/ui/components/ui/form";
import { Input } from "@openstatus/ui/components/ui/input";
import { cn } from "@openstatus/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useTransition } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Link } from "@/components/common/link";
import {
  FormCardContent,
  FormCardSeparator,
} from "@/components/forms/form-card";
import { useFormSheetDirty } from "@/components/forms/form-sheet";
import { CheckboxTree } from "@/components/ui/checkbox-tree";
import { useTRPC } from "@/lib/trpc/client";

const getSchema = (t: ReturnType<typeof useTranslations<"notifications.form">>) =>
  z.object({
    name: z.string(),
    provider: z.literal("webhook"),
    data: z.object({
      endpoint: z.string().url(),
      headers: z.array(
        z.object({
          key: z.string().min(1, t("keyRequired")),
          value: z.string(),
        }),
      ),
    }),
    monitors: z.array(z.number()),
  });

type FormValues = z.input<ReturnType<typeof getSchema>>;

export function FormWebhook({
  defaultValues,
  onSubmit,
  className,
  monitors,
  ...props
}: Omit<React.ComponentProps<"form">, "onSubmit"> & {
  defaultValues?: FormValues;
  onSubmit: (values: FormValues) => Promise<void>;
  monitors: { id: number; name: string }[];
}) {
  const t = useTranslations("notifications.form");
  const schema = getSchema(t);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues ?? {
      name: "",
      provider: "webhook",
      data: {
        endpoint: "",
        headers: [],
      },
      monitors: [],
    },
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "data.headers",
  });
  const [isPending, startTransition] = useTransition();
  const { setIsDirty } = useFormSheetDirty();
  const trpc = useTRPC();

  const sendTestMutation = useMutation(
    trpc.notification.sendTest.mutationOptions(),
  );

  const formIsDirty = form.formState.isDirty;
  React.useEffect(() => {
    setIsDirty(formIsDirty);
  }, [formIsDirty, setIsDirty]);

  function submitAction(values: FormValues) {
    if (isPending) return;

    startTransition(async () => {
      try {
        const promise = onSubmit(values);
        toast.promise(promise, {
          loading: t("saving"),
          success: t("saved"),
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

  function testAction() {
    if (isPending) return;

    startTransition(async () => {
      try {
        const provider = form.getValues("provider");
        const endpoint = form.getValues("data.endpoint");
        const headers = form.getValues("data.headers");
        const promise = sendTestMutation.mutateAsync({
          provider,
          data: {
            webhook: { endpoint, headers },
          },
        });
        toast.promise(promise, {
          loading: t("sendingTest"),
          success: t("testSent"),
          error: (error) => {
            if (error instanceof Error) {
              return error.message;
            }
            return t("failedToSendTest");
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
        <FormCardContent className="grid gap-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("name")}</FormLabel>
                <FormControl>
                  <Input placeholder={t("namePlaceholder")} {...field} />
                </FormControl>
                <FormMessage />
                <FormDescription>{t("nameDescription")}</FormDescription>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="data.endpoint"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("webhookUrl")}</FormLabel>
                <FormControl>
                  <Input placeholder={t("webhookPlaceholder")} {...field} />
                </FormControl>
                <FormMessage />
                <FormDescription>
                  {t("customWebhookDescription")}{" "}
                  <Link
                    href="https://www.openstatus.dev/docs/reference/notification/#webhook"
                    rel="noreferrer"
                    target="_blank"
                  >
                    {t("readMore")}
                  </Link>
                  .
                </FormDescription>
              </FormItem>
            )}
          />
          <FormItem>
            <FormLabel>{t("requestHeaders")}</FormLabel>
            <FormDescription>{t("requestHeadersDescription")}</FormDescription>
            {fields.map((field, index) => (
              <div key={field.id} className="grid gap-2 sm:grid-cols-5">
                <FormField
                  control={form.control}
                  name={`data.headers.${index}.key`}
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
                  name={`data.headers.${index}.value`}
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
                  onClick={() => remove(index)}
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
          <div>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={testAction}
            >
              {t("sendTest")}
            </Button>
          </div>
        </FormCardContent>
        <FormCardSeparator />
        <FormCardContent>
          <FormField
            control={form.control}
            name="monitors"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("monitors")}</FormLabel>
                <FormDescription>{t("monitorsDescription")}</FormDescription>
                <FormControl>
                  <CheckboxTree
                    items={[
                      {
                        id: -1,
                        label: t("selectAll"),
                        children: monitors.map((m) => ({
                          id: m.id,
                          label: m.name,
                        })),
                      },
                    ]}
                    value={field.value ?? []}
                    onValueChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormCardContent>
      </form>
    </Form>
  );
}
