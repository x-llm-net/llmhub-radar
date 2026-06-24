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
import { useTranslations } from "next-intl";
import React, { useTransition } from "react";
import { useForm } from "react-hook-form";
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

function getSchema(t: (key: string) => string) {
  return z.object({
  name: z.string(),
  provider: z.literal("slack"),
  data: z.url(t("invalidUrl")),
  monitors: z.array(z.number()),
});
}

type FormValues = z.infer<ReturnType<typeof getSchema>>;

export function FormSlack({
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
  const form = useForm<FormValues>({
    resolver: zodResolver(getSchema(t)),
    defaultValues: defaultValues ?? {
      name: "",
      provider: "slack",
      data: "",
      monitors: [],
    },
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
        const data = form.getValues("data");
        const promise = sendTestMutation.mutateAsync({
          provider,
          data: {
            slack: data,
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
            name="data"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("webhookUrl")}</FormLabel>
                <FormControl>
                  <Input placeholder={t("webhookPlaceholder")} {...field} />
                </FormControl>
                <FormMessage />
                <FormDescription>
                  {t("slackWebhookDescription")}{" "}
                  <Link
                    href="https://www.openstatus.dev/docs/reference/notification/#slack"
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
