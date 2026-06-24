"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@openstatus/ui/components/ui/button";
import { Checkbox } from "@openstatus/ui/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@openstatus/ui/components/ui/form";
import { Input } from "@openstatus/ui/components/ui/input";
import { SelectItem } from "@openstatus/ui/components/ui/select";
import {
  SelectContent,
  SelectValue,
} from "@openstatus/ui/components/ui/select";
import { SelectTrigger } from "@openstatus/ui/components/ui/select";
import { Select } from "@openstatus/ui/components/ui/select";
import { Textarea } from "@openstatus/ui/components/ui/textarea";
import { cn } from "@openstatus/ui/lib/utils";
import { useTranslations } from "next-intl";
import { useMemo, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

export const types = [
  {
    labelKey: "bug",
    value: "bug" as const,
  },
  {
    labelKey: "demo",
    value: "demo" as const,
  },
  {
    labelKey: "feature",
    value: "feature" as const,
  },
  {
    labelKey: "security",
    value: "security" as const,
  },
  {
    labelKey: "question",
    value: "question" as const,
  },
];

const baseSchema = z.object({
  name: z.string(),
  type: z.enum(["bug", "demo", "feature", "security", "question"]),
  email: z.email(),
  message: z.string(),
  blocker: z.boolean(),
});

export type FormValues = z.infer<typeof baseSchema>;

function createSchema(t: ReturnType<typeof useTranslations<"supportContact">>) {
  return z.object({
    name: z.string().min(1, {
      error: t("validation.nameRequired"),
    }),
    type: z.enum(["bug", "demo", "feature", "security", "question"]),
    email: z.email({
      error: t("validation.invalidEmail"),
    }),
    message: z.string().min(1, {
      error: t("validation.messageRequired"),
    }),
    blocker: z.boolean(),
  });
}

interface ContactFormProps {
  defaultValues?: Partial<FormValues>;
  onSubmit: (data: FormValues) => Promise<void>;
  className?: string;
}

export function ContactForm({
  defaultValues,
  onSubmit,
  className,
}: ContactFormProps) {
  const t = useTranslations("supportContact");
  const schema = useMemo(() => createSchema(t), [t]);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: defaultValues?.name ?? "",
      email: defaultValues?.email ?? "",
      type: defaultValues?.type ?? undefined,
      message: defaultValues?.message ?? "",
      blocker: defaultValues?.blocker ?? false,
    },
  });
  const [isPending, startTransition] = useTransition();
  const watchType = form.watch("type");

  async function submitAction(values: FormValues) {
    if (isPending) return;

    startTransition(async () => {
      try {
        const promise = onSubmit(values);
        toast.promise(promise, {
          loading: t("sending"),
          success: t("sent"),
          error: t("failed"),
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
        className={cn("grid gap-4 sm:grid-cols-2", className)}
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("name")}</FormLabel>
              <FormControl>
                <Input placeholder="Max" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("email")}</FormLabel>
              <FormControl>
                <Input placeholder="max@openstatus.dev" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem className="sm:col-span-full">
              <FormLabel>{t("type")}</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("typePlaceholder")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {types.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {t(`types.${type.labelKey}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        {watchType ? (
          <FormField
            control={form.control}
            name="message"
            render={({ field }) => (
              <FormItem className="sm:col-span-full">
                <FormLabel>{t("message")}</FormLabel>
                <FormControl>
                  <Textarea placeholder={t("messagePlaceholder")} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
        {watchType === "bug" ? (
          <FormField
            control={form.control}
            name="blocker"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start sm:col-span-full">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <FormLabel className="leading-none font-normal">
                  {t("blocker")}
                </FormLabel>
              </FormItem>
            )}
          />
        ) : null}
        <Button
          type="submit"
          className="w-full sm:col-span-full"
          disabled={isPending}
        >
          {isPending ? t("submitting") : t("submit")}
        </Button>
      </form>
    </Form>
  );
}
