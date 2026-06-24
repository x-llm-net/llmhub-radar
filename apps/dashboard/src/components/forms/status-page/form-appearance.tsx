import { zodResolver } from "@hookform/resolvers/zod";
import type { ThemeKey } from "@openstatus/theme-store";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openstatus/ui/components/ui/select";
import { isTRPCClientError } from "@trpc/client";
import { ArrowUpRight, Laptop, Moon, Sun } from "lucide-react";
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
} from "@/components/forms/form-card";
import { ThemePickerPopover } from "@/components/forms/status-page/theme-picker";

const schema = z.object({
  forceTheme: z.enum(["light", "dark", "system"]),
  configuration: z.object({
    theme: z.string(),
  }),
});

type FormValues = z.infer<typeof schema>;

export function FormAppearance({
  defaultValues,
  onSubmit,
}: {
  defaultValues?: FormValues;
  onSubmit: (values: FormValues) => Promise<void>;
}) {
  const t = useTranslations("statusPages.form");
  const [isPending, startTransition] = useTransition();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues ?? {
      forceTheme: "system",
    },
  });

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

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submitAction)}>
        <FormCard>
          <FormCardHeader>
            <FormCardTitle>{t("appearance")}</FormCardTitle>
            <FormCardDescription>
              {t("appearanceDescription")}
            </FormCardDescription>
          </FormCardHeader>
          <FormCardContent className="grid gap-4 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="forceTheme"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("mode")}</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("selectTheme")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="light">
                        <div className="flex items-center gap-2">
                          <Sun className="h-4 w-4" />
                          <span>{t("light")}</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="dark">
                        <div className="flex items-center gap-2">
                          <Moon className="h-4 w-4" />
                          <span>{t("dark")}</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="system">
                        <div className="flex items-center gap-2">
                          <Laptop className="h-4 w-4" />
                          <span>{t("system")}</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                  <FormDescription>
                    {t("overrideUserPreference")}
                  </FormDescription>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="configuration.theme"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>{t("style")}</FormLabel>
                  <ThemePickerPopover
                    value={field.value as ThemeKey}
                    onChange={field.onChange}
                  />
                  <FormMessage />
                  <FormDescription>{t("chooseTheme")}</FormDescription>
                </FormItem>
              )}
            />
          </FormCardContent>
          <FormCardFooter>
            <FormCardFooterInfo>
              {t("themeToggleNote")}
            </FormCardFooterInfo>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" asChild>
                <Link
                  href="https://themes.openstatus.dev"
                  rel="noreferrer"
                  target="_blank"
                >
                  {t("viewThemeExplorer")} <ArrowUpRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? t("submitting") : t("submit")}
              </Button>
            </div>
          </FormCardFooter>
        </FormCard>
      </form>
    </Form>
  );
}
