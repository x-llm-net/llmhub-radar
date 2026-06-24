"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@openstatus/ui/components/ui/alert-dialog";
import { Button } from "@openstatus/ui/components/ui/button";
import { Calendar } from "@openstatus/ui/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@openstatus/ui/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@openstatus/ui/components/ui/form";
import { Input } from "@openstatus/ui/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@openstatus/ui/components/ui/popover";
import {
  RadioGroup,
  RadioGroupItem,
} from "@openstatus/ui/components/ui/radio-group";
import { Textarea } from "@openstatus/ui/components/ui/textarea";
import { useCopyToClipboard } from "@openstatus/ui/hooks/use-copy-to-clipboard";
import { cn } from "@openstatus/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { format, parse } from "date-fns";
import { CalendarIcon, Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Link } from "@/components/common/link";
import {
  EmptyStateDescription,
  EmptyStateTitle,
} from "@/components/content/empty-state";
import { EmptyStateContainer } from "@/components/content/empty-state";
import { DataTable } from "@/components/data-table/settings/api-key/data-table";
import {
  FormCard,
  FormCardContent,
  FormCardDescription,
  FormCardFooter,
  FormCardFooterInfo,
  FormCardHeader,
  FormCardTitle,
} from "@/components/forms/form-card";
import { useTRPC } from "@/lib/trpc/client";

// we should prefetch the api key on the server (layout)

function getSchema(t: (key: string) => string) {
  return z.object({
  name: z.string().min(1, t("nameRequired")),
  description: z.string().optional(),
  expiresAt: z.string().optional(),
  // Single-value radio. The wire format on the create-key API is
  // an array (`scopes: Scope[]`) so per-resource scopes can land
  // additively later, but the v1 dashboard surface only ever picks
  // one of two options — flat enum here, lift to array on submit.
  //
  // Duplicates `apiKeySettableScopes` from `@openstatus/db` — the
  // dashboard's client bundle can't reach into the db package
  // (drizzle pulls in node-only deps via the schema barrel). The
  // services input schema validates whatever the form sends, so
  // drift here surfaces as a parse error on submit, not a silent
  // mismatch. Keep this list in sync with
  // `packages/db/src/schema/api-keys/constants.ts`.
  scope: z.enum(["read", "write"]),
  });
}

type FormValues = z.infer<ReturnType<typeof getSchema>>;

export function FormApiKey() {
  const t = useTranslations("settings.forms");
  const trpc = useTRPC();
  const [isPending, startTransition] = useTransition();
  const { copy, isCopied } = useCopyToClipboard();
  const [result, setResult] = useState<{
    token: string;
    key: string;
  } | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(getSchema(t)),
    defaultValues: {
      name: "",
      description: "",
      expiresAt: "",
      // Default Read-only: AI agents are the most common new use
      // case for keys, and read-only is the safer starting point.
      // CI/CD users actively pick "Read & write."
      scope: "read",
    },
  });

  const { data: workspace } = useQuery(
    trpc.workspace.getWorkspace.queryOptions(),
  );
  const { data: apiKeys = [], refetch } = useQuery(
    trpc.apiKeyRouter.getAll.queryOptions(),
  );
  const createApiKeyMutation = useMutation(
    trpc.apiKeyRouter.create.mutationOptions({
      onSuccess: (data) => {
        if (data) {
          refetch();
          setResult({ token: data.token, key: data.key.name });
          setCreateDialogOpen(false);
          form.reset();
        } else {
          throw new Error(t("failedToCreateApiKey"));
        }
      },
    }),
  );

  function createAction(values: FormValues) {
    if (isPending || !workspace) {
      return;
    }

    startTransition(async () => {
      try {
        const promise = createApiKeyMutation.mutateAsync({
          name: values.name.trim(),
          description: values.description?.trim() || undefined,
          expiresAt: values.expiresAt ? new Date(values.expiresAt) : undefined,
          scopes: [values.scope],
        });
        toast.promise(promise, {
          loading: t("creating"),
          success: () => t("createdSuccess"),
          error: (error) => {
            if (isTRPCClientError(error)) {
              return error.message;
            }
            return t("failedToCreateApiKey");
          },
        });
        await promise;
      } catch (error) {
        console.error(error);
      }
    });
  }

  return (
    <FormCard>
      <FormCardHeader>
        <FormCardTitle>{t("apiKeys")}</FormCardTitle>
        <FormCardDescription>{t("apiKeysDescription")}</FormCardDescription>
      </FormCardHeader>
      <FormCardContent>
        {apiKeys.length === 0 ? (
          <EmptyStateContainer>
            <EmptyStateTitle>{t("noApiKeys")}</EmptyStateTitle>
            <EmptyStateDescription>
              {t("noApiKeysDescription")}
            </EmptyStateDescription>
          </EmptyStateContainer>
        ) : (
          <DataTable apiKeys={apiKeys} refetch={refetch} />
        )}
      </FormCardContent>
      <FormCardFooter>
        <FormCardFooterInfo>
          {t("apiKeysFooter")}{" "}
          <Link
            href="https://api.openstatus.dev/v1"
            rel="noreferrer"
            target="_blank"
          >
            {t("learnMore")}
          </Link>
          .
        </FormCardFooterInfo>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">{t("create")}</Button>
          </DialogTrigger>
          <DialogContent
            className="max-h-[80vh] overflow-y-auto"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              document.body.style.pointerEvents = "";
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("createApiKey")}</DialogTitle>
              <DialogDescription>{t("createApiKeyDescription")}</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(createAction)}>
                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("name")}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t("apiKeyNamePlaceholder")}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
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
                          <Textarea
                            placeholder={t("apiKeyDescriptionPlaceholder")}
                            rows={3}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="scope"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("access")}</FormLabel>
                        <FormControl>
                          <RadioGroup
                            value={field.value}
                            onValueChange={field.onChange}
                            className="gap-3 sm:grid-cols-2"
                          >
                            <label className="hover:bg-muted/40 has-[[aria-checked=true]]:border-primary flex cursor-pointer items-start gap-3 rounded-md border p-3">
                              <RadioGroupItem value="read" className="mt-1" />
                              <div className="space-y-0.5">
                                <div className="text-sm font-medium">
                                  {t("readOnly")}
                                </div>
                                <div className="text-muted-foreground text-xs">
                                  {t("readOnlyDescription")}
                                </div>
                              </div>
                            </label>
                            <label className="hover:bg-muted/40 has-[[aria-checked=true]]:border-primary flex cursor-pointer items-start gap-3 rounded-md border p-3">
                              <RadioGroupItem value="write" className="mt-1" />
                              <div className="space-y-0.5">
                                <div className="text-sm font-medium">
                                  {t("readWrite")}
                                </div>
                                <div className="text-muted-foreground text-xs">
                                  {t("readWriteDescription")}
                                </div>
                              </div>
                            </label>
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="expiresAt"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>{t("expirationDate")}</FormLabel>
                        <Popover modal>
                          <FormControl>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className={cn(
                                  "w-full pl-3 text-left font-normal",
                                  !field.value && "text-muted-foreground",
                                )}
                              >
                                {field.value ? (
                                  format(new Date(field.value), "PPP")
                                ) : (
                                  <span>{t("pickDate")}</span>
                                )}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                          </FormControl>
                          <PopoverContent
                            className="pointer-events-auto w-auto p-0"
                            align="start"
                          >
                            <Calendar
                              mode="single"
                              selected={
                                field.value
                                  ? parse(field.value, "yyyy-MM-dd", new Date())
                                  : undefined
                              }
                              onSelect={(date) => {
                                if (!date) {
                                  field.onChange("");
                                  return;
                                }
                                field.onChange(format(date, "yyyy-MM-dd"));
                              }}
                              disabled={(date) => {
                                const today = new Date();
                                today.setHours(0, 0, 0, 0);
                                const compareDate = new Date(date);
                                compareDate.setHours(0, 0, 0, 0);
                                return compareDate < today;
                              }}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <DialogFooter className="mt-4">
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => setCreateDialogOpen(false)}
                  >
                    {t("cancel")}
                  </Button>
                  <Button type="submit" disabled={isPending}>
                    {t("create")}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </FormCardFooter>
      <AlertDialog open={!!result} onOpenChange={() => setResult(null)}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.body.style.pointerEvents = "";
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t("apiKeyCreated")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("apiKeyCopyWarning")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                copy(result?.token || "", {
                  successMessage: t("apiKeyCopied"),
                });
              }}
            >
              <code>{result?.token}</code>
              {isCopied ? (
                <Check size={16} className="text-muted-foreground" />
              ) : (
                <Copy size={16} className="text-muted-foreground" />
              )}
            </Button>
          </div>
          <AlertDialogFooter>
            <Button onClick={() => setResult(null)}>{t("done")}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FormCard>
  );
}
