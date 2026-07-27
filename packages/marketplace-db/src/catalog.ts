import { eq } from "drizzle-orm";

import type { MarketplaceDb } from "./db";
import { models } from "./schema";

export const INITIAL_MODELS = [
  {
    slug: "claude-sonnet-4-6",
    vendor: "Anthropic",
    family: "Claude",
    displayName: "Claude Sonnet 4.6",
    shortName: "Sonnet 4.6",
    description: "查看 Claude Sonnet 4.6 路由的近 7 日可用率与持续观测结果。",
    aliases: ["claude-sonnet-4-6", "claude-sonnet-4.6"],
    sortOrder: 1,
  },
  {
    slug: "gemini-3-flash-preview",
    vendor: "Google",
    family: "Gemini",
    displayName: "Gemini 3 Flash Preview",
    shortName: "3 Flash Preview",
    description:
      "查看 Gemini 3 Flash Preview 路由的近 7 日可用率与持续观测结果。",
    aliases: ["gemini-3-flash-preview"],
    sortOrder: 2,
  },
  {
    slug: "gemini-3-5-flash",
    vendor: "Google",
    family: "Gemini",
    displayName: "Gemini 3.5 Flash",
    shortName: "3.5 Flash",
    description: "查看 Gemini 3.5 Flash 路由的近 7 日可用率与持续观测结果。",
    aliases: ["gemini-3.5-flash", "gemini-3-5-flash"],
    sortOrder: 3,
  },
  {
    slug: "claude-fable-5",
    vendor: "Anthropic",
    family: "Claude",
    displayName: "Claude Fable 5",
    shortName: "Fable 5",
    description: "面向复杂任务与长流程 Agent 的旗舰模型。",
    aliases: ["claude-fable-5"],
    sortOrder: 10,
  },
  {
    slug: "claude-sonnet-5",
    vendor: "Anthropic",
    family: "Claude",
    displayName: "Claude Sonnet 5",
    shortName: "Sonnet 5",
    description: "兼顾代码能力、速度与日常成本。",
    aliases: ["claude-sonnet-5"],
    sortOrder: 20,
  },
  {
    slug: "claude-opus-4-8",
    vendor: "Anthropic",
    family: "Claude",
    displayName: "Claude Opus 4.8",
    shortName: "Opus 4.8",
    description: "适合复杂推理和高质量代码任务。",
    aliases: ["claude-opus-4-8", "claude-opus-4.8"],
    sortOrder: 30,
  },
  {
    slug: "gpt-5-4",
    vendor: "OpenAI",
    family: "GPT",
    displayName: "GPT 5.4",
    shortName: "GPT 5.4",
    description: "通用推理、代码与工具调用模型。",
    aliases: ["gpt-5.4", "gpt-5-4", "gpt-5.4-mini"],
    sortOrder: 40,
  },
  {
    slug: "gpt-5-3-codex",
    vendor: "OpenAI",
    family: "GPT",
    displayName: "GPT 5.3 Codex",
    shortName: "5.3 Codex",
    description: "针对代码理解和软件工程任务优化。",
    aliases: ["gpt-5.3-codex", "gpt-5-3-codex"],
    sortOrder: 50,
  },
  {
    slug: "gemini-3-1-pro",
    vendor: "Google",
    family: "Gemini",
    displayName: "Gemini 3.1 Pro",
    shortName: "3.1 Pro",
    description: "适合多模态、长上下文与综合任务。",
    aliases: ["gemini-3.1-pro", "gemini-3-1-pro"],
    sortOrder: 60,
  },
  {
    slug: "gemini-3-flash",
    vendor: "Google",
    family: "Gemini",
    displayName: "Gemini 3 Flash",
    shortName: "3 Flash",
    description: "强调速度和高频轻量调用。",
    aliases: ["gemini-3-flash"],
    sortOrder: 70,
  },
  {
    slug: "grok-4-1",
    vendor: "xAI",
    family: "Grok",
    displayName: "Grok 4.1",
    shortName: "Grok 4.1",
    description: "适合文本生成、检索和长上下文任务。",
    aliases: ["grok-4.1", "grok-4-1"],
    sortOrder: 80,
  },
] as const;

export async function seedModelCatalog(db: MarketplaceDb) {
  for (const model of INITIAL_MODELS) {
    await db
      .insert(models)
      .values({ ...model, aliases: [...model.aliases] })
      .onConflictDoNothing({
        target: models.slug,
      });
  }

  return db.select().from(models).where(eq(models.enabled, true));
}
