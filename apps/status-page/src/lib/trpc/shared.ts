import type { AppRouter } from "@openstatus/api";
import type { HTTPBatchLinkOptions, HTTPHeaders, TRPCLink } from "@trpc/client";
import { httpBatchLink } from "@trpc/client";
import type { TRPCError } from "@trpc/server";
import superjson from "superjson";

/**
 * Shared onError handler for tRPC route handlers.
 */
export function createOnError(label: string) {
  return ({ error }: { error: TRPCError }) => {
    console.log(`Error in tRPC handler (${label})`);
    console.error(error);
  };
}

/**
 * Filter out requests that don't come from our tRPC clients.
 * Our server and client links always set `x-trpc-source`.
 * This is a convention filter for bots/crawlers, not a security boundary —
 * the header is trivially spoofable. Auth is enforced by protectedProcedure.
 */
export function guardTRPCSource(req: Request): Response | null {
  const source = req.headers.get("x-trpc-source");
  if (source !== "server" && source !== "client") {
    return new Response(null, { status: 401 });
  }
  return null;
}

/**
 * Vercel populates VERCEL_URL with a bare host (e.g. "my-app.vercel.app"). If
 * a developer wrote a full URL into `.env` by mistake, this strips the scheme
 * so `https://${host}` doesn't yield `https://https://…` and crash fetch with
 * `getaddrinfo EAI_AGAIN https`. Works whether or not the prefix is present.
 */
function stripScheme(url: string): string {
  if (url.startsWith("https://")) return url.slice("https://".length);
  if (url.startsWith("http://")) return url.slice("http://".length);
  return url;
}

const getBaseUrl = () => {
  if (typeof window !== "undefined") return "";
  // Status-page has its own tRPC API routes. In local dev NEXT_PUBLIC_URL is
  // used by the dashboard app, so do not use it as a server-side fallback here.
  if (process.env.STATUS_PAGE_URL) return process.env.STATUS_PAGE_URL;
  if (process.env.NEXT_PUBLIC_STATUS_PAGE_URL)
    return process.env.NEXT_PUBLIC_STATUS_PAGE_URL;
  if (process.env.VERCEL_URL)
    return `https://${stripScheme(process.env.VERCEL_URL)}`;
  return "http://localhost:3001"; // Local dev fallback
};

const lambdas = ["stripeRouter", "emailRouter"];
const localDevLambdas = ["statusPage"];

export const endingLink = (opts?: {
  fetch?: typeof fetch;
  headers?: HTTPHeaders | (() => HTTPHeaders | Promise<HTTPHeaders>);
}) =>
  ((runtime) => {
    const sharedOpts = {
      headers: opts?.headers,
      fetch: opts?.fetch,
      transformer: superjson,
      // oxlint-disable-next-line typescript/no-explicit-any -- FIXME: remove any
    } satisfies Partial<HTTPBatchLinkOptions<any>>;

    const edgeLink = httpBatchLink({
      ...sharedOpts,
      url: `${getBaseUrl()}/api/trpc/edge`,
    })(runtime);
    const lambdaLink = httpBatchLink({
      ...sharedOpts,
      url: `${getBaseUrl()}/api/trpc/lambda`,
    })(runtime);

    return (ctx) => {
      const path = ctx.op.path.split(".") as [string, ...string[]];
      const useLocalLambda =
        process.env.NODE_ENV === "development" &&
        localDevLambdas.includes(path[0]);
      const endpoint =
        lambdas.includes(path[0]) || useLocalLambda ? "lambda" : "edge";

      const newCtx = {
        ...ctx,
        op: { ...ctx.op, path: path.join(".") },
      };
      return endpoint === "edge" ? edgeLink(newCtx) : lambdaLink(newCtx);
    };
  }) satisfies TRPCLink<AppRouter>;
