"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@openstatus/ui/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@openstatus/ui/components/ui/form";
import { Input } from "@openstatus/ui/components/ui/input";
import { Lock, Plus, X } from "lucide-react";
import NextLink from "next/link";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Link } from "@/components/common/link";
import {
  FormCard,
  FormCardContent,
  FormCardDescription,
  FormCardFooter,
  FormCardFooterInfo,
  FormCardHeader,
  FormCardTitle,
  FormCardUpgrade,
} from "@/components/forms/form-card";

// TODO: add headers

function getSchema(t: (key: string) => string) {
  return z.object({
    endpoint: z.url(t("invalidUrl")),
    headers: z
      .array(z.object({ key: z.string(), value: z.string() }))
      .prefault([]),
  });
}

type FormValues = z.input<ReturnType<typeof getSchema>>;

export function FormOtel({
  locked,
  defaultValues,
  onSubmit,
  ...props
}: Omit<React.ComponentProps<"form">, "onSubmit"> & {
  locked?: boolean;
  defaultValues?: FormValues;
  onSubmit: (values: FormValues) => Promise<void>;
}) {
  const t = useTranslations("monitors.form");
  const form = useForm<FormValues>({
    resolver: zodResolver(getSchema(t)),
    defaultValues: defaultValues ?? { endpoint: "", headers: [] },
  });
  const [isPending, startTransition] = useTransition();

  function submitAction(values: FormValues) {
    if (isPending) return;

    startTransition(async () => {
      try {
        const promise = onSubmit(values);
        toast.promise(promise, {
          loading: t("saving"),
          success: t("saved"),
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
          {locked ? <FormCardUpgrade /> : null}
          <FormCardHeader>
            <FormCardTitle>{t("openTelemetry")}</FormCardTitle>
            <FormCardDescription>{t("otelDescription")}</FormCardDescription>
          </FormCardHeader>
          <FormCardContent className="grid grid-cols-4 gap-4">
            <FormField
              control={form.control}
              name="endpoint"
              render={({ field }) => (
                <FormItem className="col-span-full">
                  <FormLabel>{t("endpoint")}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://otel.openstatus.dev/api/v1/metrics"
                      disabled={locked}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="headers"
              disabled={locked}
              render={({ field }) => (
                <FormItem className="col-span-full">
                  <FormLabel>{t("requestHeaders")}</FormLabel>
                  {field.value?.map((header, index) => (
                    <div key={index} className="grid gap-2 sm:grid-cols-5">
                      <Input
                        placeholder={t("key")}
                        className="col-span-2"
                        value={header.key}
                        disabled={locked}
                        onChange={(e) => {
                          const newHeaders = [...(field.value ?? [])];
                          newHeaders[index] = {
                            ...newHeaders[index],
                            key: e.target.value,
                          };
                          field.onChange(newHeaders);
                        }}
                      />
                      <Input
                        placeholder={t("value")}
                        className="col-span-2"
                        value={header.value}
                        disabled={locked}
                        onChange={(e) => {
                          const newHeaders = [...(field.value ?? [])];
                          newHeaders[index] = {
                            ...newHeaders[index],
                            value: e.target.value,
                          };
                          field.onChange(newHeaders);
                        }}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          const newHeaders = field.value?.filter(
                            (_, i) => i !== index,
                          );
                          field.onChange(newHeaders);
                        }}
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
                      disabled={locked}
                      onClick={() => {
                        field.onChange([
                          ...(field.value ?? []),
                          { key: "", value: "" },
                        ]);
                      }}
                    >
                      <Plus />
                      {t("addHeader")}
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormCardContent>
          <FormCardFooter>
            <FormCardFooterInfo>
              {t("learnMoreAbout")}{" "}
              <Link
                href="https://www.openstatus.dev/docs/reference/http-monitor/#opentelemetry"
                rel="noreferrer"
                target="_blank"
              >
                OTel
              </Link>
              .
            </FormCardFooterInfo>
            {locked ? (
              <Button asChild>
                <NextLink href="/settings/billing">
                  <Lock className="size-4" />
                  {t("upgrade")}
                </NextLink>
              </Button>
            ) : (
              <Button type="submit" disabled={isPending}>
                {isPending ? t("submitting") : t("submit")}
              </Button>
            )}
          </FormCardFooter>
        </FormCard>
      </form>
    </Form>
  );
}
