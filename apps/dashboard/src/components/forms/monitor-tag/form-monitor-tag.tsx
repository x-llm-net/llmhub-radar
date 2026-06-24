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
import { cn } from "@openstatus/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useTransition } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useFormSheetDirty } from "@/components/forms/form-sheet";
import { useTRPC } from "@/lib/trpc/client";

function getSchema(t: (key: string) => string) {
  const tagSchema = z.object({
    id: z.number().optional(),
    name: z.string().min(1, t("nameRequired")),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, t("invalidColor")),
  });

  return z.object({
    tags: z.array(tagSchema),
  });
}

export type FormValues = z.infer<ReturnType<typeof getSchema>>;

// FIXME: rename, its not monitor specfic, its all the tags
export function FormMonitorTag({
  defaultValues,
  className,
  onSubmit,
  ...props
}: Omit<React.ComponentProps<"form">, "onSubmit"> & {
  defaultValues?: FormValues;
  onSubmit: (values: FormValues) => Promise<void>;
}) {
  const t = useTranslations("monitors.form");
  const trpc = useTRPC();
  const { data: tags } = useQuery(trpc.monitorTag.list.queryOptions());

  const form = useForm<FormValues>({
    resolver: zodResolver(getSchema(t)),
    defaultValues: defaultValues ?? {
      tags: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "tags",
  });

  const [isPending, startTransition] = useTransition();
  const { setIsDirty } = useFormSheetDirty();

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
          loading: t("savingTags"),
          success: t("tagsSaved"),
          error: t("failedToSaveTags"),
        });
        await promise;
      } catch (error) {
        console.error(error);
      }
    });
  }

  if (!tags) return null;

  return (
    <Form {...form}>
      <form
        className={cn("grid gap-4", className)}
        onSubmit={(e) => {
          // NOTE: we use the form nested within another form, so we need to prevent the default behavior
          // and stop the propagation to avoid double submission
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit(submitAction)(e);
        }}
        {...props}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <FormLabel>{t("tags")}</FormLabel>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => append({ name: "", color: "#00008B" })}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("addTag")}
            </Button>
          </div>

          {fields.map((field, index) => (
            <div key={field.id} className="flex items-start gap-4">
              <FormField
                control={form.control}
                name={`tags.${index}.color`}
                render={({ field }) => (
                  <FormItem className="p-1">
                    <FormControl>
                      <Input
                        type="color"
                        className="size-7 overflow-hidden rounded-full p-0"
                        style={{ backgroundColor: field.value }}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`tags.${index}.name`}
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl>
                      <Input placeholder={t("tagNamePlaceholder")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </form>
    </Form>
  );
}
