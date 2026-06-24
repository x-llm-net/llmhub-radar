export const RADAR_MODEL_TYPE_OPTIONS = [
  "OpenAI",
  "Anthropic",
  "Gemini",
  "DeepSeek",
  "Qwen",
  "Grok",
  "Other",
] as const;

export function inferRadarModelType(modelName: string) {
  const normalized = modelName.toLowerCase();
  if (normalized.includes("claude") || normalized.includes("anthropic")) {
    return "Anthropic";
  }
  if (normalized.includes("gemini") || normalized.includes("google")) {
    return "Gemini";
  }
  if (normalized.includes("deepseek")) {
    return "DeepSeek";
  }
  if (normalized.includes("qwen")) {
    return "Qwen";
  }
  if (normalized.includes("grok") || normalized.includes("xai")) {
    return "Grok";
  }
  if (normalized.includes("gpt") || normalized.includes("openai")) {
    return "OpenAI";
  }
  return "Other";
}
