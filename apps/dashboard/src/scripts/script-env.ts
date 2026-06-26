import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function loadLocalEnv() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const roots = [
    process.cwd(),
    resolve(scriptDir, "../../"),
    resolve(scriptDir, "../../../../"),
  ];
  const files = [".env.local", ".env.radar", ".env.docker"];
  const candidates = roots.flatMap((root) =>
    files.map((file) => resolve(root, file)),
  );

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    loadEnvFile(file);
  }
}

export function defaultIntervalMs(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function parseBooleanEnv(name: string) {
  return process.env[name] === "true" || process.env[name] === "1";
}

function loadEnvFile(file: string) {
  const content = readFileSync(file, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalizedLine = line.startsWith("export ")
      ? line.slice("export ".length).trim()
      : line;
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = normalizedLine.slice(0, separatorIndex).trim();
    const rawValue = normalizedLine.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = unquoteEnvValue(rawValue);
  }
}

function unquoteEnvValue(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
