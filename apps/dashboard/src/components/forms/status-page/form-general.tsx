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
import { Textarea } from "@openstatus/ui/components/ui/textarea";
import { useDebounce } from "@openstatus/ui/hooks/use-debounce";
import { useMutation, useQuery } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

// FIXME: use input-group instead
import { InputWithAddons } from "@/components/common/input-with-addons";
import {
  FormCard,
  FormCardContent,
  FormCardDescription,
  FormCardFooter,
  FormCardHeader,
  FormCardSeparator,
  FormCardTitle,
} from "@/components/forms/form-card";
import { useTRPC } from "@/lib/trpc/client";

// Keep in sync with `slugSchema` in
// `packages/db/src/schema/pages/validation.ts`. We can't import that on the
// client because `@openstatus/db` is server-only. Slugs are stored lowercase
// (subdomains are case-insensitive), so we restrict input client-side too.
const SLUG_PATTERN = /^[a-z0-9-]+$/;

function formatSlug(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getSchema(t: (key: string) => string) {
  return z.object({
  title: z.string().min(1, t("titleRequired")),
  slug: z
    .string()
    .min(3, t("slugRequired"))
    .regex(SLUG_PATTERN, t("slugPattern")),
  icon: z.string().optional(),
  description: z.string().optional(),
});
}

type FormValues = z.infer<ReturnType<typeof getSchema>>;

/** Convert a File to a base64 string without the data: prefix */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is like "data:image/png;base64,XXXX" – we only need the part after the comma
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function FormGeneral({
  disabled,
  defaultValues,
  onSubmit,
  ...props
}: Omit<React.ComponentProps<"form">, "onSubmit"> & {
  defaultValues?: FormValues;
  onSubmit: (values: FormValues) => Promise<void>;
  disabled?: boolean;
}) {
  const t = useTranslations("statusPages.form");
  const form = useForm<FormValues>({
    resolver: zodResolver(getSchema(t)),
    defaultValues: defaultValues ?? {
      title: "",
      slug: "",
      icon: undefined,
      description: "",
    },
  });
  const [isPending, startTransition] = useTransition();
  const trpc = useTRPC();
  const uploadMutation = useMutation(trpc.blob.upload.mutationOptions());
  const watchSlug = form.watch("slug");
  const watchTitle = form.watch("title");
  const watchIcon = form.watch("icon");
  const debouncedSlug = useDebounce(watchSlug, 500);
  const { data: isUnique } = useQuery(
    trpc.page.getSlugUniqueness.queryOptions(
      { slug: debouncedSlug },
      { enabled: debouncedSlug.length > 0 },
    ),
  );

  useEffect(() => {
    if (!defaultValues?.title) {
      const formattedSlug = formatSlug(watchTitle);
      form.setValue("slug", formattedSlug);
    }
  }, [form, defaultValues?.title, watchTitle]);

  useEffect(() => {
    if (isUnique === undefined) return;
    if (defaultValues?.slug === debouncedSlug) return;

    if (!isUnique) {
      form.setError("slug", { message: t("slugTaken") });
    } else {
      form.clearErrors("slug");
    }
  }, [isUnique, form, debouncedSlug, defaultValues?.slug, t]);

  function submitAction(values: FormValues) {
    if (isPending || disabled) return;

    startTransition(async () => {
      try {
        if (isUnique === false && defaultValues?.slug !== values.slug) {
          toast.error(t("slugTaken"));
          form.setError("slug", { message: t("slugTaken") });
          return;
        }

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
      <form onSubmit={form.handleSubmit(submitAction)} {...props}>
        <FormCard>
          <FormCardHeader>
            <FormCardTitle>{t("general")}</FormCardTitle>
            <FormCardDescription>
              {t("generalDescription")}
            </FormCardDescription>
          </FormCardHeader>
          <FormCardSeparator />
          <FormCardContent className="grid gap-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("title")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("titlePlaceholder")} {...field} />
                  </FormControl>
                  <FormMessage />
                  <FormDescription>
                    {t("titleDescription")}
                  </FormDescription>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("slug")}</FormLabel>
                  <FormControl>
                    <InputWithAddons
                      placeholder="status"
                      trailing=".openstatus.dev"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                  <FormDescription>
                    {t("slugDescription")}
                  </FormDescription>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="icon"
              render={() => (
                <FormItem>
                  <FormLabel>{t("icon")}</FormLabel>
                  <FormControl>
                    <div className="flex items-center space-x-2">
                      {watchIcon ? (
                        <>
                          <div className="bg-muted size-[36px] overflow-hidden rounded-md border">
                            <Image
                              src={watchIcon}
                              width={36}
                              height={36}
                              alt={t("iconPreviewAlt")}
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            type="button"
                            onClick={() => form.setValue("icon", undefined)}
                          >
                            {t("remove")}
                          </Button>
                        </>
                      ) : (
                        <Input
                          type="file"
                          accept="image/png,image/x-icon,image/svg+xml"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const base64String = await fileToBase64(file);
                            try {
                              const blob = await uploadMutation.mutateAsync({
                                filename: file.name,
                                file: base64String,
                              });
                              if (blob?.url) {
                                form.setValue("icon", blob.url as string);
                              }
                            } catch (err) {
                              console.error(err);
                              toast.error(t("uploadFailed"));
                            }
                          }}
                        />
                      )}
                    </div>
                  </FormControl>
                  <FormMessage />
                  <FormDescription>
                    {t("iconDescription")}
                  </FormDescription>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("description")}</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <FormMessage />
                  <FormDescription>
                    {t("descriptionDescription")}
                  </FormDescription>
                </FormItem>
              )}
            />
          </FormCardContent>
          <FormCardFooter>
            <Button type="submit" disabled={isPending || disabled}>
              {isPending ? t("submitting") : t("submit")}
            </Button>
          </FormCardFooter>
        </FormCard>
      </form>
    </Form>
  );
}
