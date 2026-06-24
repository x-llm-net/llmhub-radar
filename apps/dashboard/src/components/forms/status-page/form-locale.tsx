import { zodResolver } from "@hookform/resolvers/zod";
import { type Locale, localeDetails, locales } from "@openstatus/locales";
import { Button } from "@openstatus/ui/components/ui/button";
import { Checkbox } from "@openstatus/ui/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@openstatus/ui/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openstatus/ui/components/ui/select";
import { isTRPCClientError } from "@trpc/client";
import { Lock } from "lucide-react";
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
  FormCardSeparator,
  FormCardTitle,
  FormCardUpgrade,
} from "@/components/forms/form-card";

const AVAILABLE_LOCALES = locales.map((code) => ({
  value: code,
  label: localeDetails[code].name,
}));

function getSchema(t: (key: string) => string) {
  return z
    .object({
      defaultLocale: z.enum(locales),
      locales: z.array(z.enum(locales)).nullable(),
    })
    .refine(
      (data) => {
        if (data.locales) {
          return data.locales.includes(data.defaultLocale);
        }
        return true;
      },
      {
        message: t("defaultLocaleIncluded"),
        path: ["defaultLocale"],
      },
    );
}

type FormValues = z.infer<ReturnType<typeof getSchema>>;

export function FormLocale({
  defaultValues,
  onSubmit,
  locked,
}: {
  defaultValues?: FormValues;
  onSubmit: (values: FormValues) => Promise<void>;
  locked?: boolean;
}) {
  const t = useTranslations("statusPages.form");
  const [isPending, startTransition] = useTransition();
  const form = useForm<FormValues>({
    resolver: zodResolver(getSchema(t)),
    defaultValues: defaultValues ?? {
      defaultLocale: "en",
      locales: null,
    },
  });

  const selectedLocales = form.watch("locales");
  const isMultiLocaleEnabled = selectedLocales !== null;

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

  function toggleMultiLocale(enabled: boolean) {
    if (enabled) {
      const currentDefault = form.getValues("defaultLocale");
      form.setValue("locales", [currentDefault], { shouldValidate: true });
    } else {
      form.setValue("locales", null, { shouldValidate: true });
    }
  }

  function toggleLocale(locale: Locale, checked: boolean) {
    const current = form.getValues("locales") ?? [];
    const updated = checked
      ? [...current, locale]
      : current.filter((l) => l !== locale);

    // Don't allow removing all locales
    if (updated.length === 0) return;

    form.setValue("locales", updated, { shouldValidate: true });

    // If the default locale was removed, switch to the first remaining locale
    const currentDefault = form.getValues("defaultLocale");
    if (!updated.includes(currentDefault)) {
      form.setValue("defaultLocale", updated[0], { shouldValidate: true });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submitAction)}>
        <FormCard>
          {locked ? <FormCardUpgrade /> : null}
          <FormCardHeader>
            <FormCardTitle>{t("locales")}</FormCardTitle>
            <FormCardDescription>
              {t("localesDescription")}
            </FormCardDescription>
          </FormCardHeader>
          <FormCardSeparator />
          <FormCardContent className="grid gap-4">
            <FormField
              control={form.control}
              name="defaultLocale"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("defaultLocale")}</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("selectDefaultLocale")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {AVAILABLE_LOCALES.map((locale) => (
                        <SelectItem key={locale.value} value={locale.value}>
                          {locale.label} ({locale.value})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>{t("defaultLocaleDescription")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="multi-locale"
                  checked={isMultiLocaleEnabled}
                  onCheckedChange={(checked) =>
                    toggleMultiLocale(checked === true)
                  }
                />
                <label
                  htmlFor="multi-locale"
                  className="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  {t("enableLocaleSwitcher")}
                </label>
              </div>
              {isMultiLocaleEnabled ? (
                <div className="ml-6 space-y-2">
                  {AVAILABLE_LOCALES.map((locale) => (
                    <div
                      key={locale.value}
                      className="flex items-center space-x-2"
                    >
                      <Checkbox
                        id={`locale-${locale.value}`}
                        checked={selectedLocales?.includes(locale.value)}
                        onCheckedChange={(checked) =>
                          toggleLocale(locale.value, checked === true)
                        }
                      />
                      <label
                        htmlFor={`locale-${locale.value}`}
                        className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        {locale.label} ({locale.value})
                      </label>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </FormCardContent>
          <FormCardFooter>
            <FormCardFooterInfo>
              {t("localeSwitcherDescription")} {t("learnMoreAbout")}{" "}
              <Link href="https://www.openstatus.dev/docs/reference/status-page/#translations-i18n">
                {t("translations")}
              </Link>
              .
            </FormCardFooterInfo>
            {locked ? (
              <Button type="button" asChild>
                <Link href="/settings/billing">
                  <Lock className="size-4" />
                  {t("upgrade")}
                </Link>
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
