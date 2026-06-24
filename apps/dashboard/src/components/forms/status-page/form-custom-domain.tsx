"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@openstatus/ui/components/ui/button";
import {
  Form,
  FormField,
  FormItem,
  FormMessage,
} from "@openstatus/ui/components/ui/form";
import { Label } from "@openstatus/ui/components/ui/label";
import { isTRPCClientError } from "@trpc/client";
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import type React from "react";
import { useEffect, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

// FIXME: use input-group instead
import { InputWithAddons } from "@/components/common/input-with-addons";
import { Link } from "@/components/common/link";
import DomainConfiguration from "@/components/domains/domain-configuration";
import { useDomainStatus } from "@/components/domains/use-domain-status";
import {
  FormCard,
  FormCardContent,
  FormCardDescription,
  FormCardFooter,
  FormCardFooterInfo,
  FormCardHeader,
  FormCardSeparator,
  FormCardTitle,
  FormCardUpgrade,
} from "@/components/forms/form-card";

const schema = z.object({
  domain: z.string(),
});

type FormValues = z.infer<typeof schema>;

export function FormCustomDomain({
  locked,
  defaultValues,
  onSubmit,
  ...props
}: Omit<React.ComponentProps<"form">, "onSubmit"> & {
  locked?: boolean;
  defaultValues?: FormValues;
  onSubmit: (values: FormValues) => Promise<void>;
}) {
  const t = useTranslations("statusPages.form");
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues ?? {
      domain: undefined,
    },
  });
  const [isPending, startTransition] = useTransition();
  const { refresh, isLoading } = useDomainStatus(defaultValues?.domain);

  function submitAction(values: FormValues) {
    if (isPending) return;

    startTransition(async () => {
      try {
        const promise = onSubmit(values);
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

  // NOTE: poll every 30 seconds to check for the status
  useEffect(() => {
    const interval = setInterval(() => refresh(), 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submitAction)} {...props}>
        <FormCard>
          {locked ? <FormCardUpgrade /> : null}
          <FormCardHeader>
            <FormCardTitle>{t("customDomain")}</FormCardTitle>
            <FormCardDescription>
              {t("customDomainDescription")}
            </FormCardDescription>
          </FormCardHeader>
          <FormCardContent>
            <FormField
              control={form.control}
              name="domain"
              render={({ field }) => (
                <FormItem>
                  <Label>{t("domain")}</Label>
                  <InputWithAddons
                    placeholder="status.openstatus.dev"
                    leading="https://"
                    disabled={locked}
                    {...field}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormCardContent>
          {defaultValues?.domain ? (
            <>
              <FormCardSeparator />
              <FormCardContent>
                <DomainConfiguration domain={defaultValues?.domain} />
              </FormCardContent>
            </>
          ) : null}
          <FormCardFooter>
            <FormCardFooterInfo>
              {t("learnMoreAbout")}{" "}
              <Link
                href="https://www.openstatus.dev/docs/reference/status-page/#custom-domain"
                rel="noreferrer"
                target="_blank"
              >
                {t("customDomain")}
              </Link>
              .
            </FormCardFooterInfo>
            {locked ? (
              <Button type="button" asChild>
                <Link href="/settings/billing">
                  <Lock />
                  {t("upgrade")}
                </Link>
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isPending || isLoading}
                  onClick={refresh}
                  className="hidden sm:block"
                >
                  {isLoading ? t("refreshing") : t("refreshConfiguration")}
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? t("submitting") : t("submit")}
                </Button>
              </div>
            )}
          </FormCardFooter>
        </FormCard>
      </form>
    </Form>
  );
}
