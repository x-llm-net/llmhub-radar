import type { Page } from "@openstatus/db/src/schema";

import { pickPreferredLocale } from "../locale-negotiation";
import type { ResolvedRoute } from "../resolve-route";

/**
 * If the URL had no explicit locale segment, swap in the page's configured
 * default locale (when it differs from the route's fallback default).
 *
 * Pure function — returns a new ResolvedRoute rather than mutating the input.
 * Runs once in proxy.ts after the DB query, before the composer, so every
 * downstream stage sees a locale-normalised route.
 */
export function applyPageLocaleOverride(
  route: ResolvedRoute,
  page: Pick<Page, "defaultLocale" | "locales">,
  acceptLanguage?: string | null,
): ResolvedRoute {
  if (route.localeExplicit) return route;
  const preferredLocale = pickPreferredLocale({
    acceptLanguage,
    enabledLocales: page.locales,
    fallbackLocale: page.defaultLocale,
  });
  if (preferredLocale === route.locale) return route;

  return {
    ...route,
    locale: preferredLocale,
    rewritePath: route.rewritePath.replace(
      `/${route.prefix}/${route.locale}`,
      `/${route.prefix}/${preferredLocale}`,
    ),
  };
}
