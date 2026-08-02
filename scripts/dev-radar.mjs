import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = resolve(root, ".env.radar");

function parseEnvFile(path) {
  if (!existsSync(path)) return {};

  const result = {};
  const lines = readFileSync(path, "utf8").split(/\r?\n/);

  for (const line of lines) {
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

const dashboardPort = process.env.DASHBOARD_PORT ?? "3000";
const statusPagePort = process.env.STATUS_PAGE_PORT ?? "3001";
const marketplacePort = process.env.MARKETPLACE_PORT ?? "3010";
const envFromFile = parseEnvFile(envFile);
const statusPageOrigin = `http://127.0.0.1:${statusPagePort}`;
const marketplaceApiOrigin = `http://127.0.0.1:${marketplacePort}`;
const inheritedEnv = { ...process.env };
const inheritedPath = inheritedEnv.Path ?? inheritedEnv.PATH ?? "";
delete inheritedEnv.Path;
delete inheritedEnv.PATH;
const pathKey = process.platform === "win32" ? "Path" : "PATH";

const childEnv = {
  ...inheritedEnv,
  ...envFromFile,
  [pathKey]: `${dirname(process.execPath)}${
    process.platform === "win32" ? ";" : ":"
  }${inheritedPath}`,
  AUTH_TRUST_HOST: "true",
  AUTH_URL: `http://localhost:${dashboardPort}`,
  DATABASE_URL:
    process.env.RADAR_DEV_DATABASE_URL ??
    envFromFile.RADAR_DEV_DATABASE_URL ??
    "http://localhost:18080",
  MEDIA_STORAGE_ROOT:
    process.env.MEDIA_STORAGE_ROOT ??
    envFromFile.MEDIA_STORAGE_ROOT ??
    resolve(root, ".tmp/media"),
  MARKETPLACE_DATABASE_URL:
    process.env.MARKETPLACE_DATABASE_URL ??
    envFromFile.MARKETPLACE_DATABASE_URL ??
    "postgres://llmhub:llmhub@127.0.0.1:55432/llmhub_marketplace",
  MARKETPLACE_API_INTERNAL_URL: marketplaceApiOrigin,
  MARKETPLACE_MANAGEMENT_TOKEN:
    process.env.MARKETPLACE_MANAGEMENT_TOKEN ??
    envFromFile.MARKETPLACE_MANAGEMENT_TOKEN ??
    "llmhub-local-management-token",
  RADAR_CREDENTIAL_SECRET:
    process.env.RADAR_CREDENTIAL_SECRET ??
    envFromFile.RADAR_CREDENTIAL_SECRET ??
    "llmhub-local-credential-secret-at-least-32-characters",
  NEXT_PUBLIC_MARKETPLACE_API_URL: marketplaceApiOrigin,
  NEXT_PUBLIC_MARKETPLACE_URL:
    process.env.NEXT_PUBLIC_MARKETPLACE_URL ??
    envFromFile.NEXT_PUBLIC_MARKETPLACE_URL ??
    "http://127.0.0.1:18792",
  NEXT_PUBLIC_STATUS_PAGE_URL: statusPageOrigin,
  NEXT_PUBLIC_DASHBOARD_URL: `http://localhost:${dashboardPort}`,
  NEXT_PUBLIC_URL: `http://localhost:${dashboardPort}`,
  NODE_ENV: "development",
  STATUS_PAGE_URL: statusPageOrigin,
};

const isWindows = process.platform === "win32";
const pnpm = isWindows
  ? (process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe")
  : "pnpm";
const processes = [
  {
    name: "dashboard",
    args: ["--filter", "@openstatus/dashboard", "dev", "--port", dashboardPort],
  },
  {
    name: "status-page",
    args: [
      "--filter",
      "@openstatus/status-page",
      "dev",
      "--port",
      statusPagePort,
    ],
  },
  {
    name: "marketplace-api",
    args: ["--filter", "@llmhub/marketplace-api", "dev"],
    env: { PORT: marketplacePort },
  },
];

console.log("Starting LLMHub Radar local dev servers");
console.log(`- dashboard:   http://localhost:${dashboardPort}`);
console.log(`- status page: ${statusPageOrigin}`);
console.log(`- rankings:    ${marketplaceApiOrigin}`);
console.log(`- database:    ${childEnv.DATABASE_URL}`);
console.log(`- media:       ${childEnv.MEDIA_STORAGE_ROOT}`);
console.log("");

let shuttingDown = false;
const children = processes.map(({ name, args, env }) => {
  const childArgs = isWindows
    ? ["/d", "/s", "/c", ["pnpm", ...args].join(" ")]
    : args;
  const child = spawn(pnpm, childArgs, {
    cwd: root,
    env: { ...childEnv, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(prefixLines(name, chunk));
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(prefixLines(name, chunk));
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(
      `[${name}] exited${signal ? ` by ${signal}` : ""}${
        code == null ? "" : ` with code ${code}`
      }`,
    );
    shutdown();
  });

  return child;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdown(signal);
  });
}

function prefixLines(name, chunk) {
  return String(chunk)
    .split(/\r?\n/)
    .map((line, index, lines) => {
      if (index === lines.length - 1 && line === "") return "";
      return `[${name}] ${line}`;
    })
    .join("\n");
}

function shutdown(signal) {
  for (const child of children) {
    if (!child.killed) child.kill(signal ?? "SIGTERM");
  }
  setTimeout(() => process.exit(signal ? 0 : 1), 500).unref();
}
