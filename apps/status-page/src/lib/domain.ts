import type { NextRequest } from "next/server";

// Custom-domain lookups exact-match page.customDomain, which is stored without a
// port; an inbound host like "status.acme.com:8080" must be normalized first.
export const stripHostPort = (host?: string | null) =>
  host ? host.replace(/:\d+$/, "") : (host ?? null);

export const isLocalhostLikeHost = (host?: string | null) => {
  const normalized = stripHostPort(host)?.replace(/^\[|\]$/g, "").toLowerCase();

  if (!normalized) return false;
  if (normalized === "localhost" || normalized === "::1") return true;
  return /^\d+\.\d+\.\d+\.\d+$/.test(normalized);
};

export const getValidSubdomain = (host?: string | null) => {
  let subdomain: string | null = null;
  if (!host && typeof window !== "undefined") {
    // On client side, get the host from window
    host = window.location.host;
  }

  const normalizedHost = stripHostPort(host);

  // Exclude localhost and IP addresses from being treated as subdomains
  if (isLocalhostLikeHost(normalizedHost)) {
    return null;
  }

  // Handle subdomains of localhost (e.g., hello.localhost:3000)
  if (normalizedHost?.match(/^([^.]+)\.localhost$/)) {
    const match = normalizedHost.match(/^([^.]+)\.localhost$/);
    return match?.[1] || null;
  }

  // we should improve here for custom vercel deploy page
  if (normalizedHost?.includes(".") && !normalizedHost.includes(".vercel.app")) {
    const candidate = normalizedHost.split(".")[0];
    if (candidate && !candidate.includes("www")) {
      // Valid candidate
      subdomain = candidate;
    }
  }

  // In case the host is a custom domain
  if (
    normalizedHost &&
    !(
      normalizedHost.includes("stpg.dev") ||
      normalizedHost.includes("openstatus.dev") ||
      normalizedHost.endsWith(".vercel.app")
    )
  ) {
    subdomain = normalizedHost;
  }
  return subdomain;
};

export const getValidCustomDomain = (req: NextRequest | Request) => {
  const url = "nextUrl" in req ? req.nextUrl.clone() : new URL(req.url);
  const headers = req.headers;
  const host = headers.get("x-forwarded-host");

  let prefix = "";
  let type: "hostname" | "pathname";

  const hostnames = host?.split(/[.:]/) ?? url.host.split(/[.:]/);
  const pathnames = url.pathname.split("/");

  const subdomain = getValidSubdomain(url.host);
  console.log({
    hostnames,
    pathnames,
    host,
    urlHost: url.host,
    subdomain,
  });

  if (
    hostnames.length > 2 &&
    hostnames[0] !== "www" &&
    !url.host.endsWith(".vercel.app")
  ) {
    prefix = hostnames[0].toLowerCase();
    type = "hostname";
  } else {
    prefix = pathnames[1].toLowerCase();
    type = "pathname";
  }

  if (subdomain !== null) {
    prefix = subdomain.toLowerCase();
  }

  console.log({ type, prefix });

  return { type, prefix };
};
