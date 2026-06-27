import { stripPrefixForExternal } from "./strip-prefix-for-external";
import type { Action, ComposeInput } from "./types";

type Input = Pick<ComposeInput, "route" | "pathname" | "search" | "requestUrl">;

export function resolveMissingLocaleAction({
  route,
  pathname,
  search,
  requestUrl,
}: Input): Action | null {
  if (route.localeExplicit) return null;
  if (route.rewritePath === pathname) return null;

  const externalPath = stripPrefixForExternal(route, route.rewritePath);
  const url = new URL(externalPath || "/", requestUrl);
  url.search = search;

  return {
    type: "redirect",
    url,
    reason: "missing-locale-redirect",
  };
}
