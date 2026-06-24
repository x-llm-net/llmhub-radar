const DEFAULT_FROM_ADDRESS = "notifications@llm-hub.store";
const DEFAULT_FROM_NAME = "LLMHub Radar";

function sanitizeDisplayName(name: string) {
  return name.replace(/[<>"]/g, "").trim() || DEFAULT_FROM_NAME;
}

export function getEmailFrom(name?: string) {
  const address =
    process.env.EMAIL_FROM_ADDRESS?.trim() || DEFAULT_FROM_ADDRESS;
  const displayName = sanitizeDisplayName(
    name ?? process.env.EMAIL_FROM_NAME ?? DEFAULT_FROM_NAME,
  );

  return `${displayName} <${address}>`;
}
