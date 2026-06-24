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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openstatus/ui/components/ui/select";
import { cn } from "@openstatus/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  FormCardContent,
  FormCardSeparator,
} from "@/components/forms/form-card";
import { CheckboxTree } from "@/components/ui/checkbox-tree";
import { useTRPC } from "@/lib/trpc/client";

const schema = z.object({
  name: z.string(),
  provider: z.literal("opsgenie"),
  data: z.record(z.string(), z.string()),
  monitors: z.array(z.number()),
});

type FormValues = z.infer<typeof schema>;

export function FormOpsGenie({
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
    resolver: zodResolver(schema),
    defaultValues: defaultValues ?? {
      name: "",
      provider: "opsgenie",
      data: {
        apiKey: "",
        region: undefined,
      },
      monitors: [],
    },
  });
  const [isPending, startTransition] = useTransition();
  const trpc = useTRPC();

  const sendTestMutation = useMutation(
    trpc.notification.sendTest.mutationOptions(),
  );

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
            opsgenie: data,
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
            name="data.apiKey"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("apiKey")}</FormLabel>
                <FormControl>
                  <Input placeholder="your-api-key" {...field} />
                </FormControl>
                <FormMessage />
                <FormDescription>{t("apiKeyDescription")}</FormDescription>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="data.region"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("region")}</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={t("selectRegion")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="us">US</SelectItem>
                    <SelectItem value="eu">EU</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
                <FormDescription>{t("regionDescription")}</FormDescription>
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
