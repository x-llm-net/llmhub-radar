type UrlValidationResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

const BLOCKED_HOSTS = new Set([
  "localhost",
  "ip6-localhost",
  "metadata.google.internal",
]);

const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".lan"];

export function validateProbeBaseUrl(input: string): UrlValidationResult {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "unsupported_protocol" };
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");

  if (!hostname) {
    return { ok: false, reason: "missing_host" };
  }

  if (BLOCKED_HOSTS.has(hostname) || hostname === "0.0.0.0") {
    return { ok: false, reason: "blocked_host" };
  }

  if (PRIVATE_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return { ok: false, reason: "private_host" };
  }

  if (!hostname.includes(".") && hostname !== "localhost") {
    return { ok: false, reason: "private_host" };
  }

  if (isRawIpAddress(hostname)) {
    return { ok: false, reason: "raw_ip_blocked" };
  }

  // TODO: resolve DNS at request time and block private/link-local IP answers.
  return { ok: true, url };
}

export function buildChatCompletionsUrl(baseUrl: URL) {
  const url = new URL(baseUrl.toString());
  const pathname = url.pathname.replace(/\/+$/, "");

  if (pathname.endsWith("/chat/completions")) {
    return url;
  }

  if (pathname.endsWith("/v1")) {
    url.pathname = `${pathname}/chat/completions`;
    return url;
  }

  url.pathname = `${pathname}/v1/chat/completions`.replace(/\/{2,}/g, "/");
  return url;
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
    if (!/^\d+$/.test(part)) {
      return false;
    }

    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}
