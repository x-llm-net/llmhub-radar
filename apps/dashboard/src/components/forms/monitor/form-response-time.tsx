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
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  FormCard,
  FormCardContent,
  FormCardDescription,
  FormCardFooter,
  FormCardHeader,
  FormCardTitle,
} from "@/components/forms/form-card";

const DEGRADED = 30_000;
const TIMEOUT = 45_000;

const schema = z.object({
  degradedAfter: z.coerce.number<number>().optional(),
  timeout: z.coerce.number<number>(),
});

type FormValues = z.input<typeof schema>;

export function FormResponseTime({
  defaultValues,
  onSubmit,
  ...props
}: Omit<React.ComponentProps<"form">, "onSubmit"> & {
  defaultValues?: FormValues;
  onSubmit: (values: FormValues) => Promise<void>;
}) {
  const t = useTranslations("monitors.form");
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues ?? {
      degradedAfter: DEGRADED,
      timeout: TIMEOUT,
    },
  });
  const [isPending, startTransition] = useTransition();

  function submitAction(values: FormValues) {
    if (isPending) return;

    startTransition(async () => {
      try {
        const promise = onSubmit(values);
        toast.promise(promise, {
          loading: t("saving"),
          success: () => t("saved"),
          error: t("failedToSave"),
        });
        await promise;
      } catch (error) {
        console.error(error);
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submitAction)} {...props}>
        <FormCard>
          <FormCardHeader>
            <FormCardTitle>{t("responseTimeThresholds")}</FormCardTitle>
            <FormCardDescription>
              {t("responseTimeDescription")}
            </FormCardDescription>
          </FormCardHeader>
          <FormCardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="degradedAfter"
              render={({ field }) => (
                <FormItem className="self-start">
                  <FormLabel>{t("degradedMs")}</FormLabel>
                  <FormControl>
                    <Input placeholder="30000" type="number" {...field} />
                  </FormControl>
                  <FormDescription>
                    {t("degradedDescription")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="timeout"
              render={({ field }) => (
                <FormItem className="self-start">
                  <FormLabel>{t("timeoutMs")}</FormLabel>
                  <FormControl>
                    <Input placeholder="45000" type="number" {...field} />
                  </FormControl>
                  <FormDescription>
                    {t("timeoutDescription")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormCardContent>
          <FormCardFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? t("submitting") : t("submit")}
            </Button>
          </FormCardFooter>
        </FormCard>
      </form>
    </Form>
  );
}
