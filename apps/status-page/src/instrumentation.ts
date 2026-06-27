import type * as SentryTypes from "@sentry/nextjs";

function shouldEnableSentry() {
  return Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);
}

export async function register() {
  if (!shouldEnableSentry()) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export async function onRequestError(
  ...args: Parameters<typeof SentryTypes.captureRequestError>
) {
  if (!shouldEnableSentry()) return;

  const Sentry = await import("@sentry/nextjs");
  return Sentry.captureRequestError(...args);
}
