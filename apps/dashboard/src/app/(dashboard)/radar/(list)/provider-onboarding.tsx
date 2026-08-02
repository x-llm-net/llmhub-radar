"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import { Input } from "@openstatus/ui/components/ui/input";
import { Label } from "@openstatus/ui/components/ui/label";
import { Textarea } from "@openstatus/ui/components/ui/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, LoaderCircle } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { useTRPC } from "@/lib/trpc/client";

export function ProviderOnboarding() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const providersOptions = trpc.hub.providers.queryOptions();
  const createProvider = useMutation(
    trpc.hub.createProvider.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(providersOptions);
        toast.success("渠道供给已开通，可以添加第一个分组了");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    createProvider.mutate({
      name,
      description,
      websiteUrl: websiteUrl.trim() || null,
    });
  };

  return (
    <SectionGroup className="max-w-5xl px-4 py-8 lg:px-6 lg:py-10">
      <Section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)] lg:gap-14">
        <SectionHeader className="max-w-xl">
          <div className="bg-primary text-primary-foreground mb-3 flex size-10 items-center justify-center rounded-md">
            <Building2 className="size-5" />
          </div>
          <SectionTitle className="text-2xl">开通渠道供给</SectionTitle>
          <SectionDescription className="max-w-lg text-sm leading-6">
            先填写你的渠道商信息。开通后，你可以创建分组并配置 Base URL、API Key
            和分组倍率。
          </SectionDescription>
        </SectionHeader>

        <form
          className="grid gap-5 border-t pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10"
          onSubmit={submit}
        >
          <div className="grid gap-2">
            <Label htmlFor="hub-provider-name">渠道商名称</Label>
            <Input
              id="hub-provider-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如 X-LLM"
              required
              maxLength={160}
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="hub-provider-website">官网</Label>
            <Input
              id="hub-provider-website"
              type="url"
              value={websiteUrl}
              onChange={(event) => setWebsiteUrl(event.target.value)}
              placeholder="https://example.com"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="hub-provider-description">简介</Label>
            <Textarea
              id="hub-provider-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="面向用户公开展示的简短说明"
              maxLength={500}
              rows={3}
            />
          </div>
          <Button type="submit" disabled={createProvider.isPending}>
            {createProvider.isPending ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Check />
            )}
            开通并继续
          </Button>
        </form>
      </Section>
    </SectionGroup>
  );
}
