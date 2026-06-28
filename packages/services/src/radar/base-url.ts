import { ValidationError } from "../errors";
import { hashSecret } from "./crypto";

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal"]);
const BLOCKED_IPS = new Set(["0.0.0.0", "127.0.0.1", "::1"]);

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = parts;
  if (a === undefined || b === undefined) return false;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(lower)) return true;
  if (BLOCKED_IPS.has(lower)) return true;
  if (lower.endsWith(".local")) return true;
  if (isPrivateIpv4(lower)) return true;
  return false;
}

function isRawIpAddress(hostname: string) {
  return isIpv4Address(hostname) || hostname.includes(":");
}

function isIpv4Address(hostname: string) {
  const parts = hostname.split(".");

  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

function isLocalDevelopmentHostname(hostname: string) {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

function isSingleLabelHostname(hostname: string) {
  return !hostname.includes(".") && !isRawIpAddress(hostname);
}

export function normalizeRadarBaseUrl(input: string): string {
  const url = new URL(input);
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new ValidationError("Base URL must use http or https.");
  }
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new ValidationError("Base URL must use https in production.");
  }
  if (url.username || url.password) {
    throw new ValidationError("Base URL must not include credentials.");
  }
  if (isBlockedHostname(url.hostname)) {
    throw new ValidationError("Base URL points to a blocked host.");
  }
  if (
    isSingleLabelHostname(url.hostname.toLowerCase()) &&
    !isLocalDevelopmentHostname(url.hostname.toLowerCase())
  ) {
    throw new ValidationError(
      "Base URL must use a full hostname, for example https://api.example.com.",
    );
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

export async function getBaseUrlHostHash(baseUrl: string): Promise<string> {
  const url = new URL(baseUrl);
  return hashSecret(url.hostname.toLowerCase());
}

export function maskBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const parts = url.hostname.split(".");
  if (parts.length <= 2) return url.hostname;
  return `${parts[0]}.*.${parts.slice(-2).join(".")}`;
}
