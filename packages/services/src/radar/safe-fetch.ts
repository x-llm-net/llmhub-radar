import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_REDIRECTS = 3;

type FetchLike = (
  input: URL | RequestInfo,
  init?: RequestInit,
) => Promise<Response>;

export class UnsafeUpstreamUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUpstreamUrlError";
  }
}

export async function safeUpstreamFetch(
  input: URL | string,
  init: RequestInit,
  fetchImplementation: FetchLike = fetch,
) {
  let url = new URL(input);
  const originalOrigin = url.origin;
  const validateDns = fetchImplementation === fetch;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertSafeUpstreamUrl(url, validateDns);
    const response = await fetchImplementation(url, {
      ...init,
      redirect: "manual",
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) return response;
    if (redirects === MAX_REDIRECTS) {
      throw new UnsafeUpstreamUrlError("Too many upstream redirects.");
    }
    const nextUrl = new URL(location, url);
    if (nextUrl.origin !== originalOrigin) {
      throw new UnsafeUpstreamUrlError(
        "Cross-origin upstream redirects are not allowed.",
      );
    }
    url = nextUrl;
  }

  throw new UnsafeUpstreamUrlError("Too many upstream redirects.");
}

async function assertSafeUpstreamUrl(url: URL, validateDns: boolean) {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UnsafeUpstreamUrlError("Unsupported upstream protocol.");
  }
  if (url.username || url.password) {
    throw new UnsafeUpstreamUrlError("Upstream URL contains credentials.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || isBlockedHostname(hostname)) {
    throw new UnsafeUpstreamUrlError("Upstream URL points to a blocked host.");
  }
  if (!validateDns) return;

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicIp(address))
  ) {
    throw new UnsafeUpstreamUrlError(
      "Upstream hostname resolves to a blocked address.",
    );
  }
}

function isBlockedHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "metadata.google.internal" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    (isIP(hostname) !== 0 && !isPublicIp(hostname))
  );
}

function isPublicIp(address: string) {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function isPublicIpv4(address: string) {
  const octets = address.split(".").map(Number);
  const [a = -1, b = -1] = octets;
  if (octets.length !== 4) return false;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPublicIpv6(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return false;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return false;
  if (/^fe[89ab]/.test(normalized)) return false;
  if (normalized.startsWith("ff")) return false;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped?.[1] ? isPublicIpv4(mapped[1]) : true;
}
