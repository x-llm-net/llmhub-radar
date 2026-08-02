import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = resolve(root, ".env.radar");
const envFromFile = parseEnvFile(envFile);
const localEnv = {
  ...process.env,
  ...envFromFile,
  DATABASE_URL: "http://127.0.0.1:18080",
  MARKETPLACE_DATABASE_URL:
    "postgres://llmhub:llmhub@127.0.0.1:55432/llmhub_marketplace",
  MARKETPLACE_MANAGEMENT_TOKEN:
    process.env.MARKETPLACE_MANAGEMENT_TOKEN ??
    envFromFile.MARKETPLACE_MANAGEMENT_TOKEN ??
    "llmhub-local-management-token",
  RADAR_CREDENTIAL_SECRET:
    process.env.RADAR_CREDENTIAL_SECRET ??
    envFromFile.RADAR_CREDENTIAL_SECRET ??
    "llmhub-local-credential-secret-at-least-32-characters",
};

await run("docker", [
  "compose",
  "-f",
  "docker-compose.radar.yaml",
  "up",
  "-d",
  "libsql",
]);
await run("docker", [
  "compose",
  "-f",
  "docker-compose.marketplace.yaml",
  "up",
  "-d",
  "postgres",
]);
await runPackageScript("@openstatus/db", "migrate");
await runPackageScript("@llmhub/marketplace-db", "migrate");
await run("docker", [
  "compose",
  "-f",
  "docker-compose.radar.yaml",
  "stop",
  "dashboard",
  "status-page",
  "marketplace-api",
]);

console.log("LLMHub Radar local databases are ready");
console.log("Run `pnpm dev:radar` to start the local web services");

function parseEnvFile(path) {
  if (!existsSync(path)) return {};

  const result = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;

    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function runPackageScript(filter, script) {
  if (process.platform === "win32") {
    return run("cmd.exe", [
      "/d",
      "/s",
      "/c",
      `pnpm --filter ${filter} ${script}`,
    ]);
  }
  return run("pnpm", ["--filter", filter, script]);
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: localEnv,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `${command} exited${signal ? ` by ${signal}` : ` with code ${code}`}`,
        ),
      );
    });
  });
}
