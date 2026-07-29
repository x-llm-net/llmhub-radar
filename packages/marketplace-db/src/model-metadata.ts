export type MarketplaceModelMetadata = {
  vendor: string;
  family: string;
};

export type MarketplaceModelSortInput = {
  slug: string;
  vendor?: string | null;
  family?: string | null;
  displayName?: string | null;
  sortOrder?: number | null;
};

const familyOrder = new Map([
  ["Claude", 0],
  ["GPT", 1],
  ["Gemini", 2],
  ["Grok", 3],
  ["Llama", 4],
  ["DeepSeek", 5],
  ["Qwen", 6],
  ["Other", 99],
]);
const otherFamilyRank = 99;

const lineOrderByFamily = {
  Claude: ["opus", "sonnet", "fable", "haiku"],
  GPT: ["gpt", "codex", "o"],
  Gemini: ["flash", "pro"],
  Grok: ["grok"],
} as const;

const displayTokenOverrides = new Map([
  ["api", "API"],
  ["gpt", "GPT"],
  ["ocr", "OCR"],
  ["stt", "STT"],
  ["tts", "TTS"],
  ["vl", "VL"],
  ["xai", "xAI"],
  ["claude", "Claude"],
  ["codex", "Codex"],
  ["deepseek", "DeepSeek"],
  ["gemini", "Gemini"],
  ["grok", "Grok"],
  ["llama", "Llama"],
  ["openai", "OpenAI"],
  ["qwen", "Qwen"],
]);

function normalizedModelName(value: string) {
  return value.trim().toLowerCase();
}

export function modelSlug(value: string) {
  return (
    normalizedModelName(value)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "model"
  );
}

export function inferModelMetadata(name: string): MarketplaceModelMetadata {
  const lower = normalizedModelName(name);
  if (lower.startsWith("claude")) {
    return { vendor: "Anthropic", family: "Claude" };
  }
  if (
    lower.startsWith("gpt") ||
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.startsWith("o4")
  ) {
    return { vendor: "OpenAI", family: "GPT" };
  }
  if (lower.startsWith("gemini")) {
    return { vendor: "Google", family: "Gemini" };
  }
  if (lower.startsWith("grok")) {
    return { vendor: "xAI", family: "Grok" };
  }
  if (lower.startsWith("llama")) {
    return { vendor: "Meta", family: "Llama" };
  }
  if (lower.startsWith("deepseek")) {
    return { vendor: "DeepSeek", family: "DeepSeek" };
  }
  if (lower.startsWith("qwen")) {
    return { vendor: "Alibaba", family: "Qwen" };
  }
  return { vendor: "Other", family: "Other" };
}

function formatWordToken(token: string) {
  const override = displayTokenOverrides.get(token);
  if (override) return override;
  if (/^\d+[a-z]+$/.test(token)) {
    return token.replace(/[a-z]+$/g, (suffix) => suffix.toUpperCase());
  }
  return token.charAt(0).toUpperCase() + token.slice(1);
}

export function formatModelDisplayName(value: string) {
  const tokens = modelSlug(value).split("-");
  const parts: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (/^\d+$/.test(token)) {
      const numbers = [token];
      while (/^\d+$/.test(tokens[index + 1] ?? "")) {
        index += 1;
        numbers.push(tokens[index]);
      }
      parts.push(numbers.join("."));
      continue;
    }
    parts.push(formatWordToken(token));
  }

  return parts.join(" ");
}

export function formatModelShortName(value: string) {
  const displayName = formatModelDisplayName(value);
  return displayName
    .replace(/^Claude\s+/i, "")
    .replace(/^Gemini\s+/i, "")
    .replace(/^Grok\s+/i, "");
}

function isSlugLikeModelName(value: string, slug: string) {
  return modelSlug(value) === modelSlug(slug);
}

function parseModelSort(input: MarketplaceModelSortInput) {
  const slug = modelSlug(input.slug);
  const tokens = slug.split("-");
  const inferred = inferModelMetadata(slug);
  const family = input.family || inferred.family;
  const familyRank = familyOrder.get(family) ?? otherFamilyRank;
  const lineRank = getLineRank(family, tokens);
  const version = getVersionScore(tokens);
  const previewRank = tokens.includes("preview") ? 1 : 0;
  const displayName = input.displayName || formatModelDisplayName(slug);

  return {
    slug,
    family,
    familyRank,
    lineRank,
    version,
    previewRank,
    displayName,
    sortOrder: input.sortOrder ?? 0,
  };
}

function getLineRank(family: string, tokens: string[]) {
  const lines =
    lineOrderByFamily[family as keyof typeof lineOrderByFamily] ?? [];
  const tokenSet = new Set(tokens);
  const index = lines.findIndex((line) => tokenSet.has(line));
  return index >= 0 ? index : lines.length + 1;
}

function getVersionScore(tokens: string[]) {
  const firstNumberIndex = tokens.findIndex((token) => /^\d+$/.test(token));
  if (firstNumberIndex < 0) return 0;
  const numbers = [];
  for (let index = firstNumberIndex; index < tokens.length; index += 1) {
    if (!/^\d+$/.test(tokens[index])) break;
    numbers.push(Number(tokens[index]));
  }
  return numbers.reduce(
    (score, value, index) => score + value / 100 ** index,
    0,
  );
}

function compareValues(left: number | string, right: number | string) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left).localeCompare(String(right));
}

export function compareMarketplaceModels(
  left: MarketplaceModelSortInput,
  right: MarketplaceModelSortInput,
) {
  const leftSort = parseModelSort(left);
  const rightSort = parseModelSort(right);
  const familyRank =
    compareValues(leftSort.familyRank, rightSort.familyRank) ||
    compareValues(leftSort.family, rightSort.family);
  if (familyRank) return familyRank;

  if (leftSort.family === "Claude" && rightSort.family === "Claude") {
    return (
      compareValues(leftSort.lineRank, rightSort.lineRank) ||
      compareValues(rightSort.version, leftSort.version) ||
      compareValues(leftSort.previewRank, rightSort.previewRank) ||
      compareValues(leftSort.sortOrder, rightSort.sortOrder) ||
      compareValues(leftSort.displayName, rightSort.displayName) ||
      compareValues(leftSort.slug, rightSort.slug)
    );
  }

  return (
    compareValues(rightSort.version, leftSort.version) ||
    compareValues(leftSort.lineRank, rightSort.lineRank) ||
    compareValues(leftSort.previewRank, rightSort.previewRank) ||
    compareValues(leftSort.sortOrder, rightSort.sortOrder) ||
    compareValues(leftSort.displayName, rightSort.displayName) ||
    compareValues(leftSort.slug, rightSort.slug)
  );
}

export function presentMarketplaceModel<
  T extends {
    slug: string;
    displayName: string;
    shortName: string;
  },
>(model: T): T {
  const displayName = isSlugLikeModelName(model.displayName, model.slug)
    ? formatModelDisplayName(model.slug)
    : model.displayName;
  const shortName =
    isSlugLikeModelName(model.shortName, model.slug) ||
    model.shortName === model.displayName
      ? formatModelShortName(model.slug)
      : model.shortName;

  return {
    ...model,
    displayName,
    shortName,
  };
}
