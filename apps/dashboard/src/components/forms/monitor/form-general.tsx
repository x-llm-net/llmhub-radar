"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  dnsRecords,
  headerAssertion,
  jsonBodyAssertion,
  numberCompareDictionary,
  recordAssertion,
  recordCompareDictionary,
  statusAssertion,
  stringCompareDictionary,
  textBodyAssertion,
} from "@openstatus/assertions";
import { monitorMethods } from "@openstatus/db/src/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@openstatus/ui/components/ui/alert-dialog";
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
import { Input } from "@openstatus/ui/components/ui/input";
import {
  RadioGroup,
  RadioGroupItem,
} from "@openstatus/ui/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openstatus/ui/components/ui/select";
import { Switch } from "@openstatus/ui/components/ui/switch";
import { Textarea } from "@openstatus/ui/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openstatus/ui/components/ui/tooltip";
import { cn } from "@openstatus/ui/lib/utils";
import { isTRPCClientError } from "@trpc/client";
import { Globe, Network, Plus, Server, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
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
} from "@/components/forms/form-card";

const TYPES = ["http", "tcp", "dns"] as const;
const HTTP_ASSERTION_TYPES = ["status", "header", "textBody"] as const;
const DNS_ASSERTION_TYPES = dnsRecords;

function getSchema(t: (key: string) => string) {
  return z.object({
  name: z.string().min(1, t("nameRequired")),
  type: z.enum(TYPES),
  method: z.enum(monitorMethods),
  url: z.string().min(1, t("urlRequired")),
  headers: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    }),
  ),
  active: z.boolean().optional().prefault(true),
  assertions: z.array(
    z.discriminatedUnion("type", [
      statusAssertion,
      headerAssertion,
      textBodyAssertion,
      jsonBodyAssertion,
      recordAssertion,
    ]),
  ),
  body: z.string().optional(),
  skipCheck: z.boolean().optional().prefault(false),
  saveCheck: z.boolean().optional().prefault(false),
});
}

type FormValues = z.input<ReturnType<typeof getSchema>>;

export function FormGeneral({
  defaultValues,
  disabled,
  onSubmit,
  ...props
}: Omit<React.ComponentProps<"form">, "onSubmit"> & {
  defaultValues?: FormValues;
  onSubmit: (values: FormValues) => Promise<void>;
  disabled?: boolean;
}) {
  const t = useTranslations("monitors.form");
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(getSchema(t)),
    defaultValues: defaultValues ?? {
      active: true,
      name: "",
      type: undefined,
      method: "GET",
      url: "",
      headers: [],
      body: "",
      assertions: [],
      skipCheck: false,
      saveCheck: false,
    },
  });
  const [isPending, startTransition] = useTransition();
  const watchType = form.watch("type");
  const watchMethod = form.watch("method");

  useEffect(() => {
    // NOTE: reset form when type changes
    if (watchType && !defaultValues) {
      form.setValue("assertions", []);
      form.setValue("body", "");
      form.setValue("headers", []);
      form.setValue("method", "GET");
      form.setValue("url", "");
    }
  }, [watchType, defaultValues, form]);

  function submitAction(values: FormValues) {
    console.log("submitAction", values);
    if (isPending || disabled) return;

    // Validate assertions based on type
    for (let i = 0; i < values.assertions.length; i++) {
      const assertion = values.assertions[i];

      if (assertion.type === "status") {
        if (typeof assertion.target !== "number" || assertion.target <= 0) {
          form.setError(`assertions.${i}.target`, {
            message: t("statusTargetPositive"),
          });
          return;
        }
      } else if (assertion.type === "header") {
        if (!assertion.key || assertion.key.trim() === "") {
          form.setError(`assertions.${i}.key`, {
            message: t("headerKeyRequired"),
          });
          return;
        }
        if (!assertion.target || assertion.target.trim() === "") {
          form.setError(`assertions.${i}.target`, {
            message: t("headerTargetRequired"),
          });
          return;
        }
      } else if (assertion.type === "textBody") {
        if (!assertion.target || assertion.target.trim() === "") {
          form.setError(`assertions.${i}.target`, {
            message: t("bodyTargetRequired"),
          });
          return;
        }
      } else if (assertion.type === "dnsRecord") {
        if (!assertion.key || assertion.key.trim() === "") {
          form.setError(`assertions.${i}.key`, {
            message: t("dnsRecordKeyRequired"),
          });
          return;
        }
        if (!assertion.target || assertion.target.trim() === "") {
          form.setError(`assertions.${i}.target`, {
            message: t("dnsRecordTargetRequired"),
          });
          return;
        }
      }
    }

    startTransition(async () => {
      try {
        const promise = onSubmit(values);
        toast.promise(promise, {
          loading: t("saving"),
          success: t("saved"),
          error: (error) => {
            if (isTRPCClientError(error)) {
              setError(error.message);
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
            <FormCardTitle>{t("monitorConfiguration")}</FormCardTitle>
            <FormCardDescription>
              {t("monitorConfigurationDescription")}
            </FormCardDescription>
          </FormCardHeader>
          <FormCardContent className="grid gap-4 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>{t("name")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("namePlaceholder")} {...field} />
                  </FormControl>
                  <FormMessage />
                  <FormDescription>
                    {t("nameDescription")}
                  </FormDescription>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center">
                  <FormLabel>{t("active")}</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </FormCardContent>
          <FormCardSeparator />
          <FormCardContent>
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("monitoringType")}</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="grid grid-cols-2 gap-4 sm:grid-cols-4"
                      disabled={!!defaultValues?.type}
                    >
                      {[
                        { value: "http", icon: Globe, label: "HTTP" },
                        { value: "tcp", icon: Network, label: "TCP" },
                        { value: "dns", icon: Server, label: "DNS" },
                      ].map((type) => {
                        return (
                          <Tooltip key={type.value}>
                            <TooltipTrigger asChild>
                              <FormItem
                                className={cn(
                                  "border-input has-aria-[invalid=true]:border-destructive has-data-[state=checked]:border-primary/50 has-focus-visible:border-ring has-focus-visible:ring-ring/50 relative flex cursor-pointer flex-row items-center gap-3 rounded-md border px-2 py-3 text-center shadow-xs transition-[color,box-shadow] outline-none has-focus-visible:ring-[3px]",
                                  defaultValues &&
                                    defaultValues.type !== type.value &&
                                    "pointer-events-none opacity-50",
                                )}
                              >
                                <FormControl>
                                  <RadioGroupItem
                                    value={type.value}
                                    className="sr-only"
                                    disabled={!!defaultValues?.type}
                                  />
                                </FormControl>
                                <type.icon
                                  className="text-muted-foreground shrink-0"
                                  size={16}
                                  aria-hidden="true"
                                />
                                <FormLabel className="text-foreground cursor-pointer text-xs leading-none font-medium after:absolute after:inset-0">
                                  {type.label}
                                </FormLabel>
                              </FormItem>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("monitorTypeImmutable")}
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                      <div
                        className={cn(
                          "text-muted-foreground col-span-1 self-end text-xs sm:place-self-end",
                        )}
                      >
                        {t("missingType")}{" "}
                        <a href="mailto:ping@openstatus.dev">{t("contactUs")}</a>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormCardContent>
          {watchType ? <FormCardSeparator /> : null}
          {watchType === "http" && (
            <>
              <FormCardContent className="grid grid-cols-4 gap-4">
                <div className="col-span-1">
                  <FormField
                    control={form.control}
                    name="method"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("method")}</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder={t("selectMethod")} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {monitorMethods.map((method) => (
                              <SelectItem key={method} value={method}>
                                {method}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="col-span-3">
                  <FormField
                    control={form.control}
                    name="url"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("url")}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="https://openstatus.dev"
                            type="url"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="headers"
                  render={({ field }) => (
                    <FormItem className="col-span-full">
                      <FormLabel>{t("requestHeaders")}</FormLabel>
                      {field.value.map((header, index) => (
                        <div key={index} className="grid gap-2 sm:grid-cols-5">
                          <Input
                            placeholder={t("key")}
                            className="col-span-2"
                            value={header.key}
                            onChange={(e) => {
                              const newHeaders = [...field.value];
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
                            onChange={(e) => {
                              const newHeaders = [...field.value];
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
                              const newHeaders = field.value.filter(
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
                          onClick={() => {
                            field.onChange([
                              ...field.value,
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
                {["POST", "PUT", "PATCH", "DELETE"].includes(watchMethod) && (
                  <FormField
                    control={form.control}
                    name="body"
                    render={({ field }) => (
                      <FormItem className="col-span-full">
                        <FormLabel>{t("body")}</FormLabel>
                        <FormControl>
                          <Textarea {...field} />
                        </FormControl>
                        <FormDescription>{t("writePayload")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </FormCardContent>
              <FormCardSeparator />
              <FormCardContent>
                <FormField
                  control={form.control}
                  name="assertions"
                  render={({ field }) => (
                    <FormItem className="col-span-full">
                      <FormLabel>{t("assertions")}</FormLabel>
                      <FormDescription>
                        {t("assertionsDescription")} <br />
                        {t("addHttpAssertions")}
                      </FormDescription>
                      {field.value.map((assertion, index) => (
                        <div key={index} className="grid gap-2 sm:grid-cols-6">
                          <FormField
                            control={form.control}
                            name={`assertions.${index}.type`}
                            render={({ field }) => (
                              <FormItem>
                                <Select
                                  value={field.value}
                                  onValueChange={field.onChange}
                                  disabled={true}
                                >
                                  <SelectTrigger
                                    aria-invalid={
                                      !!form.formState.errors.assertions?.[
                                        index
                                      ]?.type
                                    }
                                    className="w-full"
                                  >
                                    <SelectValue placeholder={t("selectType")} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {HTTP_ASSERTION_TYPES.map((type) => (
                                      <SelectItem key={type} value={type}>
                                        {type}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`assertions.${index}.compare`}
                            render={({ field }) => (
                              <FormItem>
                                <Select
                                  value={field.value}
                                  onValueChange={field.onChange}
                                >
                                  <SelectTrigger className="w-full min-w-16">
                                    <span className="truncate">
                                      <SelectValue placeholder={t("selectCompare")} />
                                    </span>
                                  </SelectTrigger>
                                  <SelectContent>
                                    {assertion.type === "status"
                                      ? Object.entries(
                                          numberCompareDictionary,
                                        ).map(([key, value]) => (
                                          <SelectItem key={key} value={key}>
                                            {value}
                                          </SelectItem>
                                        ))
                                      : Object.entries(
                                          stringCompareDictionary,
                                        ).map(([key, value]) => (
                                          <SelectItem key={key} value={key}>
                                            {value}
                                          </SelectItem>
                                        ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          {assertion.type === "header" && (
                            <FormField
                              control={form.control}
                              name={`assertions.${index}.key`}
                              render={({ field }) => (
                                <FormItem>
                                  <Input
                                    placeholder={t("headerKeyPlaceholder")}
                                    className="w-full"
                                    {...field}
                                    value={field.value as string}
                                  />
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          )}
                          <FormField
                            control={form.control}
                            name={`assertions.${index}.target`}
                            render={({ field }) => (
                              <FormItem>
                                <Input
                                  placeholder={t("targetValuePlaceholder")}
                                  className="w-full"
                                  type={
                                    assertion.type === "status"
                                      ? "number"
                                      : "text"
                                  }
                                  {...field}
                                  value={field.value?.toString() || ""}
                                  onChange={(e) => {
                                    const value =
                                      assertion.type === "status"
                                        ? Number.parseInt(e.target.value) || 0
                                        : e.target.value;
                                    field.onChange(value);
                                  }}
                                />
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            type="button"
                            onClick={() => {
                              const newAssertions = field.value.filter(
                                (_, i) => i !== index,
                              );
                              field.onChange(newAssertions);
                            }}
                          >
                            <X />
                          </Button>
                        </div>
                      ))}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          type="button"
                          onClick={() => {
                            const currentAssertions =
                              form.getValues("assertions");
                            field.onChange([
                              ...currentAssertions,
                              {
                                type: "status",
                                version: "v1",
                                compare: "eq",
                                target: 200,
                              },
                            ]);
                          }}
                        >
                          <Plus />
                          {t("addStatusAssertion")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          type="button"
                          onClick={() => {
                            const currentAssertions =
                              form.getValues("assertions");
                            field.onChange([
                              ...currentAssertions,
                              {
                                type: "header",
                                version: "v1",
                                compare: "eq",
                                key: "",
                                target: "",
                              },
                            ]);
                          }}
                        >
                          <Plus />
                          {t("addHeaderAssertion")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          type="button"
                          onClick={() => {
                            const currentAssertions =
                              form.getValues("assertions");
                            field.onChange([
                              ...currentAssertions,
                              {
                                type: "textBody",
                                version: "v1",
                                compare: "eq",
                                target: "",
                              },
                            ]);
                          }}
                        >
                          <Plus />
                          {t("addBodyAssertion")}
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FormCardContent>
            </>
          )}
          {watchType === "tcp" && (
            <FormCardContent className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>{t("hostPort")}</FormLabel>
                    <FormControl>
                      <Input placeholder="127.0.0.0.1:8080" {...field} />
                    </FormControl>
                    <FormMessage />
                    <FormDescription>
                      The input supports both IPv4 addresses and IPv6 addresses.
                    </FormDescription>
                  </FormItem>
                )}
              />
              <div className="text-muted-foreground col-span-full text-sm">
                Examples:
                <ul className="list-inside list-disc">
                  <li>
                    Domain:{" "}
                    <span className="text-foreground font-mono">
                      openstatus.dev:443
                    </span>
                  </li>
                  <li>
                    IPv4:{" "}
                    <span className="text-foreground font-mono">
                      192.168.1.1:443
                    </span>
                  </li>
                  <li>
                    IPv6:{" "}
                    <span className="text-foreground font-mono">
                      [2001:db8:85a3:8d3:1319:8a2e:370:7348]:443
                    </span>
                  </li>
                </ul>
              </div>
            </FormCardContent>
          )}
          {watchType === "dns" && (
            <>
              <FormCardContent className="grid gap-4 sm:grid-cols-3">
                <FormField
                  control={form.control}
                  name="url"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>{t("uri")}</FormLabel>
                      <FormControl>
                        <Input placeholder="openstatus.dev" {...field} />
                      </FormControl>
                      <FormMessage />
                      <FormDescription>
                        {t("urlHelp")}
                      </FormDescription>
                    </FormItem>
                  )}
                />
              </FormCardContent>
              <FormCardSeparator />
              <FormCardContent>
                <FormField
                  control={form.control}
                  name="assertions"
                  render={({ field }) => (
                    <FormItem className="col-span-full">
                      <FormLabel>{t("assertions")}</FormLabel>
                      <FormDescription>
                        {t("assertionsDescription")} <br />
                        {t("addDnsRecordAssertions")}
                      </FormDescription>
                      {field.value.map((assertion, index) => (
                        <div key={index} className="grid gap-2 sm:grid-cols-6">
                          <FormField
                            control={form.control}
                            name={`assertions.${index}.type`}
                            defaultValue={"dnsRecord"}
                            render={({ field }) => (
                              <FormItem className="hidden">
                                <Select
                                  value={field.value}
                                  onValueChange={field.onChange}
                                  disabled
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder={t("selectType")} />
                                  </SelectTrigger>
                                </Select>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`assertions.${index}.key`}
                            render={({ field }) => (
                              <FormItem>
                                <Select
                                  value={field.value as string}
                                  onValueChange={field.onChange}
                                >
                                  <SelectTrigger
                                    aria-invalid={
                                      !!form.formState.errors.assertions?.[
                                        index
                                      ]?.type
                                    }
                                    className="w-full"
                                  >
                                    <SelectValue placeholder="Select type" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {DNS_ASSERTION_TYPES.map((type) => (
                                      <SelectItem key={type} value={type}>
                                        {type}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`assertions.${index}.compare`}
                            render={({ field }) => (
                              <FormItem>
                                <Select
                                  value={field.value}
                                  onValueChange={field.onChange}
                                >
                                  <SelectTrigger className="w-full min-w-16">
                                    <span className="truncate">
                                      <SelectValue placeholder={t("selectCompare")} />
                                    </span>
                                  </SelectTrigger>
                                  <SelectContent>
                                    {Object.entries(
                                      recordCompareDictionary,
                                    ).map(([key, value]) => (
                                      <SelectItem key={key} value={key}>
                                        {value}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          {assertion.type === "header" && (
                            <FormField
                              control={form.control}
                              name={`assertions.${index}.key`}
                              render={({ field }) => (
                                <FormItem>
                                  <Input
                                    placeholder={t("headerKeyPlaceholder")}
                                    className="w-full"
                                    {...field}
                                    value={field.value as string}
                                  />
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          )}
                          <FormField
                            control={form.control}
                            name={`assertions.${index}.target`}
                            render={({ field }) => (
                              <FormItem>
                                <Input
                                  placeholder={t("targetValuePlaceholder")}
                                  className="w-full"
                                  type={
                                    assertion.type === "status"
                                      ? "number"
                                      : "text"
                                  }
                                  {...field}
                                  value={field.value?.toString() || ""}
                                  onChange={(e) => {
                                    const value =
                                      assertion.type === "status"
                                        ? Number.parseInt(e.target.value) || 0
                                        : e.target.value;
                                    field.onChange(value);
                                  }}
                                />
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            type="button"
                            onClick={() => {
                              const newAssertions = field.value.filter(
                                (_, i) => i !== index,
                              );
                              field.onChange(newAssertions);
                            }}
                          >
                            <X />
                          </Button>
                        </div>
                      ))}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          type="button"
                          onClick={() => {
                            const currentAssertions =
                              form.getValues("assertions");
                            field.onChange([
                              ...currentAssertions,
                              {
                                type: "dnsRecord",
                                version: "v1",
                                compare: "eq",
                                key: "A",
                                target: "",
                              },
                            ]);
                          }}
                        >
                          <Plus />
                          {t("addDnsRecordAssertion")}
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FormCardContent>
            </>
          )}
          <FormCardFooter>
            <FormCardFooterInfo>
              {t("learnMoreAbout")}{" "}
              <Link
                href="https://www.openstatus.dev/docs/tutorial/how-to-create-monitor/"
                rel="noreferrer"
                target="_blank"
              >
                {t("monitorTypeLink")}
              </Link>{" "}
              {t("and")}{" "}
              <Link
                href="https://www.openstatus.dev/docs/tutorial/how-to-create-monitor/"
                rel="noreferrer"
                target="_blank"
              >
                {t("assertionsLink")}
              </Link>
              . {t("saveAndTestDescription")}
            </FormCardFooterInfo>
            <Button type="submit" disabled={isPending || disabled}>
              {isPending ? t("submitting") : t("submit")}
            </Button>
          </FormCardFooter>
        </FormCard>
        <AlertDialog open={!!error} onOpenChange={() => setError(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("stillSave")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("stillSaveDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="border-destructive/20 bg-destructive/10 max-h-48 overflow-auto rounded-md border p-2 whitespace-pre">
              <p className="text-destructive font-mono text-sm">{error}</p>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel type="button">{t("cancel")}</AlertDialogCancel>
              <AlertDialogAction
                type="button"
                onClick={async (e) => {
                  e.preventDefault();
                  form.setValue("skipCheck", true);
                  form.handleSubmit(submitAction)();
                  form.setValue("skipCheck", false);
                  setError(null);
                }}
                disabled={isPending}
              >
                {t("save")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </form>
    </Form>
  );
}
