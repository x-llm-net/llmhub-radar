"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { defaultLocale as globalDefaultLocale } from "@/i18n/config";
import { resolvePathnamePrefix } from "@/lib/resolve-pathname-prefix";
import { useTRPC } from "@/lib/trpc/client";

export function usePathnamePrefix() {
  const trpc = useTRPC();
  const { domain } = useParams<{ domain: string }>();
  const { data: page } = useQuery({
    ...trpc.statusPage.get.queryOptions({ slug: domain }),
  });
  const locale = useLocale();
  const defaultLocale = page?.defaultLocale || globalDefaultLocale;
  const [prefix, setPrefix] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const pathname = window.location.pathname;
      const firstSegment = pathname.split("/").filter(Boolean)[0];

      if (domain && firstSegment === domain) {
        setPrefix(`${domain}/${locale}`);
        return;
      }

      setPrefix(
        resolvePathnamePrefix({
          hostname: window.location.hostname,
          pathname,
          customDomain: page?.customDomain,
          locale,
          defaultLocale,
        }),
      );
    }
  }, [page?.customDomain, locale, defaultLocale, domain]);

  return prefix;
}
