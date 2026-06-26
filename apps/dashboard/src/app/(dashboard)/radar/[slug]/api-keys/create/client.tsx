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
import { ArrowLeft, CircleHelp, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
} from "../../../model-types";

function uniqueModels(models: Array<string | null | undefined>) {
  return Array.from(
    new Set(models.filter((model): model is string => Boolean(model))),
  );
}

export function Client() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const t = useTranslations("radar");
  const commonT = useTranslations("common");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const poolQueryOptions = trpc.radar.getPool.queryOptions({
    slug: params.slug,
  });
  const { data: pool } = useQuery(poolQueryOptions);
  const defaultProvider = pool?.providers[0];
  const [modelType, setModelType] = useState("OpenAI");
  const [modelTypeTouched, setModelTypeTouched] = useState(false);
  const [apiKeyName, setApiKeyName] = useState(() => t("demo.targetName"));
  const [probeModel, setProbeModel] = useState("");
  const [probeModelTouched, setProbeModelTouched] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const debouncedApiKey = useDebounce(apiKey.trim(), 700);
  const discoveryEnabled =
    Boolean(defaultProvider) && debouncedApiKey.trim().length >= 8;
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
    const found = discoveredModels.data?.models;
    if (!found?.length || probeModelTouched) return;
    setProbeModel(found[0]);
    if (!modelTypeTouched) {
      setModelType(inferRadarModelType(found[0]));
    }
  }, [discoveredModels.data?.models, modelTypeTouched, probeModelTouched]);

  const discoveredModelOptions = uniqueModels([
    probeModel,
    ...(discoveredModels.data?.models ?? []),
  ]);
  const selectedModelType = modelType || "OpenAI";
  const selectedProbeModel = probeModel;
  const discoveryMessage = discoveredModels.isFetching
    ? t("modelsDiscovering")
    : discoveredModels.isSuccess && discoveredModels.data.models.length > 0
      ? t("modelsDiscovered", {
          count: discoveredModels.data.models.length,
        })
      : discoveredModels.isError
        ? discoveredModels.error.message
        : null;

  const addTokenProbe = useMutation(
    trpc.radar.addTokenProbe.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(poolQueryOptions);
        toast.success(t("tokenProbeAdded"));
        router.push(`/radar/${params.slug}`);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>{t("addTokenProbe")}</SectionTitle>
          <SectionDescription>
            {t("addTokenProbeDescription")}
          </SectionDescription>
        </SectionHeader>
        <form
          className="grid max-w-3xl gap-4 rounded-md border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!defaultProvider || !pool) {
              toast.error(t("noProvidersForTokenProbe"));
              return;
            }
            if (!selectedProbeModel) {
              toast.error(t("probeModelRequired"));
              return;
            }
            addTokenProbe.mutate({
              poolSlug: pool.slug,
              apiKeyName,
              modelType: selectedModelType,
              apiKey,
              probeModel: selectedProbeModel,
              availableModels: discoveredModelOptions,
            });
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="radar-token-provider">{t("provider")}</Label>
              <Input
                id="radar-token-provider"
                value={defaultProvider?.displayName ?? "-"}
                disabled
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
                  {RADAR_MODEL_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
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
              <Label htmlFor="radar-token-api-key">
                {t("monitoringApiKey")}
              </Label>
              <Input
                id="radar-token-api-key"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setProbeModelTouched(false);
                }}
                placeholder={t("apiKeyPlaceholder")}
                type="password"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="radar-token-probe-model">
                {t("probeModel")}
              </Label>
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
                    {t("probeModelHelp")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Select
              value={selectedProbeModel}
              disabled={discoveredModelOptions.length === 0}
              onValueChange={(value) => {
                setProbeModel(value);
                setProbeModelTouched(true);
                if (!modelTypeTouched) {
                  setModelType(inferRadarModelType(value));
                }
              }}
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
                {discoveredModelOptions.map((model) => (
                  <SelectItem key={model} value={model} className="font-mono">
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
            <Button
              type="submit"
              disabled={
                addTokenProbe.isPending ||
                !defaultProvider ||
                !selectedProbeModel
              }
            >
              <Plus className="size-4" />
              {addTokenProbe.isPending ? t("creating") : t("addTokenProbe")}
            </Button>
          </div>
        </form>
      </Section>
    </SectionGroup>
  );
}
