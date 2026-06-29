"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import { Input } from "@openstatus/ui/components/ui/input";
import { Label } from "@openstatus/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@openstatus/ui/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@openstatus/ui/components/ui/tooltip";
import { useDebounce } from "@openstatus/ui/hooks/use-debounce";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CircleHelp, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  EmptyStateContainer,
  EmptyStateDescription,
  EmptyStateTitle,
} from "@/components/content/empty-state";
import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { useTRPC } from "@/lib/trpc/client";

import {
  RADAR_MODEL_TYPE_OPTIONS,
  inferRadarModelType,
} from "../../../../model-types";

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );
}

export function Client() {
  const params = useParams<{ slug: string; credentialId: string }>();
  const router = useRouter();
  const t = useTranslations("radar");
  const commonT = useTranslations("common");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const credentialId = Number(params.credentialId);
  const poolQueryOptions = trpc.radar.getPool.queryOptions({
    slug: params.slug,
  });
  const { data: pool } = useQuery(poolQueryOptions);
  const credential = pool?.credentials.find((item) => item.id === credentialId);
  const target = pool?.targets.find(
    (item) => item.credentialId === credentialId,
  );
  const [apiKeyName, setApiKeyName] = useState("");
  const [modelType, setModelType] = useState("OpenAI");
  const [modelTypeTouched, setModelTypeTouched] = useState(false);
  const [probeModel, setProbeModel] = useState("");
  const [probeModelTouched, setProbeModelTouched] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const debouncedApiKey = useDebounce(apiKey.trim(), 700);
  const discoveryEnabled = Boolean(pool) && debouncedApiKey.trim().length >= 8;
  const discoveredModels = useQuery(
    trpc.radar.discoverModelsForPool.queryOptions(
      {
        poolSlug: params.slug,
        apiKey: debouncedApiKey,
      },
      {
        enabled: discoveryEnabled,
        retry: false,
      },
    ),
  );

  useEffect(() => {
    if (!credential) return;
    setApiKeyName(credential.name);
    setModelType(credential.modelGroup || "OpenAI");
    setProbeModel(target?.modelName ?? credential.modelCatalog[0] ?? "");
    setModelTypeTouched(false);
    setProbeModelTouched(false);
    setApiKey("");
  }, [credential, target?.modelName]);

  useEffect(() => {
    const found = discoveredModels.data?.models;
    if (!found?.length || probeModelTouched) return;
    setProbeModel(found[0]);
    if (!modelTypeTouched) {
      setModelType(inferRadarModelType(found[0]));
    }
  }, [discoveredModels.data?.models, modelTypeTouched, probeModelTouched]);

  const modelTypeOptions = useMemo(
    () => uniqueStrings([credential?.modelGroup, ...RADAR_MODEL_TYPE_OPTIONS]),
    [credential?.modelGroup],
  );
  const modelOptions = useMemo(() => {
    const discoveredModelOptions = discoveredModels.data?.models ?? [];
    return uniqueStrings([
      probeModel,
      target?.modelName,
      ...(discoveredModelOptions.length > 0
        ? discoveredModelOptions
        : (credential?.modelCatalog ?? [])),
    ]);
  }, [
    credential?.modelCatalog,
    discoveredModels.data?.models,
    probeModel,
    target?.modelName,
  ]);
  const selectedModelType = modelType || credential?.modelGroup || "OpenAI";
  const selectedProbeModel =
    probeModel || target?.modelName || credential?.modelCatalog[0] || "";
  const discoveryMessage = discoveredModels.isFetching
    ? t("modelsDiscovering")
    : discoveredModels.isSuccess && discoveredModels.data.models.length > 0
      ? t("modelsDiscovered", {
          count: discoveredModels.data.models.length,
        })
      : discoveredModels.isError
        ? discoveredModels.error.message
        : null;

  const updateTokenProbe = useMutation(
    trpc.radar.updateTokenProbe.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(poolQueryOptions);
        toast.success(t("apiKeyUpdated"));
        router.push(`/radar/${params.slug}`);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  if (!pool || !credential) {
    return (
      <SectionGroup>
        <EmptyStateContainer className="min-h-40">
          <EmptyStateTitle>{t("apiKeyNotFound")}</EmptyStateTitle>
          <EmptyStateDescription>
            {t("apiKeyNotFoundDescription")}
          </EmptyStateDescription>
          <Button size="sm" asChild>
            <Link href={`/radar/${params.slug}`}>
              <ArrowLeft className="size-4" />
              {commonT("cancel")}
            </Link>
          </Button>
        </EmptyStateContainer>
      </SectionGroup>
    );
  }

  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>{t("editApiKey")}</SectionTitle>
          <SectionDescription>{t("editApiKeyDescription")}</SectionDescription>
        </SectionHeader>
        <form
          className="grid max-w-3xl gap-4 rounded-md border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedProbeModel) {
              toast.error(t("probeModelRequired"));
              return;
            }
            updateTokenProbe.mutate({
              poolSlug: pool.slug,
              credentialId,
              apiKeyName,
              apiKey: apiKey.trim() || undefined,
              modelType: selectedModelType,
              probeModel: selectedProbeModel,
              availableModels: uniqueStrings([
                selectedProbeModel,
                ...modelOptions,
              ]),
            });
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="radar-token-group">{t("apiKeyName")}</Label>
              <Input
                id="radar-token-group"
                value={apiKeyName}
                onChange={(event) => setApiKeyName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="radar-token-type">{t("modelType")}</Label>
              <Select
                value={selectedModelType}
                onValueChange={(value) => {
                  setModelType(value);
                  setModelTypeTouched(true);
                }}
              >
                <SelectTrigger id="radar-token-type" className="w-full">
                  <span className="min-w-0 flex-1 truncate text-left">
                    {selectedModelType || t("modelType")}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {modelTypeOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="radar-token-api-key">{t("monitoringApiKey")}</Label>
            <Input
              id="radar-token-api-key"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setProbeModelTouched(false);
              }}
              placeholder={t("replacementApiKeyPlaceholder")}
              type="password"
            />
            <p className="text-muted-foreground text-xs">
              {t("replacementApiKeyHelp")}
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="radar-token-probe-model">{t("probeModel")}</Label>
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <CircleHelp className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-72">
                    {t("editProbeModelHelp")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Select
              value={selectedProbeModel}
              onValueChange={(value) => {
                setProbeModel(value);
                setProbeModelTouched(true);
                if (!modelTypeTouched) {
                  setModelType(inferRadarModelType(value));
                }
              }}
              disabled={modelOptions.length === 0}
              required
            >
              <SelectTrigger
                id="radar-token-probe-model"
                className="w-full font-mono"
              >
                <span className="min-w-0 flex-1 truncate text-left">
                  {selectedProbeModel || t("probeModel")}
                </span>
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {discoveryMessage ? (
              <p className="text-muted-foreground text-xs">
                {discoveryMessage}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" asChild>
              <Link href={`/radar/${params.slug}`}>
                <ArrowLeft className="size-4" />
                {commonT("cancel")}
              </Link>
            </Button>
            <Button type="submit" disabled={updateTokenProbe.isPending}>
              <Save className="size-4" />
              {updateTokenProbe.isPending ? t("saving") : t("saveApiKey")}
            </Button>
          </div>
        </form>
      </Section>
    </SectionGroup>
  );
}
