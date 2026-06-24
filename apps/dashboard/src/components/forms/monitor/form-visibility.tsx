"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@openstatus/ui/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@openstatus/ui/components/ui/form";
import { Switch } from "@openstatus/ui/components/ui/switch";
import { Lock } from "lucide-react";
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

const schema = z.object({
  visibility: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

export function FormVisibility({
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
    resolver: zodResolver(schema),
    defaultValues: defaultValues ?? {
      visibility: false,
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
            <FormCardTitle>{t("visibility")}</FormCardTitle>
            <FormCardDescription>
              {t("visibilityDescription")}
            </FormCardDescription>
          </FormCardHeader>
          <FormCardContent>
            <FormField
              control={form.control}
              name="visibility"
              disabled={locked}
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between">
                  <div className="space-y-0.5">
                    <FormLabel>{t("allowPublicAccess")}</FormLabel>
                    <FormDescription>
                      {t("visibilityHelp")}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={locked}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </FormCardContent>
          <FormCardFooter>
            <FormCardFooterInfo>
              {t("learnMoreAbout")}{" "}
              <Link
                href="https://www.openstatus.dev/docs/reference/http-monitor/#public"
                rel="noreferrer"
                target="_blank"
              >
                {t("monitorVisibilityLink")}
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
