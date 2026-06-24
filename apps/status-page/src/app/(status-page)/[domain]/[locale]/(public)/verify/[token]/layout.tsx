"use client";

import {
  Status,
  StatusContent,
  StatusDescription,
  StatusHeader,
  StatusTitle,
} from "@openstatus/ui/components/blocks/status-layout";
import { useQuery } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { useParams } from "next/navigation";

import { getStatusPageDescription } from "@/lib/status-page-copy";
import { useTRPC } from "@/lib/trpc/client";

export default function EventLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = useLocale();
  const { domain } = useParams<{ domain: string }>();
  const trpc = useTRPC();
  const { data: page } = useQuery(
    trpc.statusPage.get.queryOptions({ slug: domain }),
  );

  if (!page) return null;

  return (
    <Status>
      <StatusHeader>
        <StatusTitle>{page.title}</StatusTitle>
        <StatusDescription>
          {getStatusPageDescription(page.description, locale)}
        </StatusDescription>
      </StatusHeader>
      <StatusContent>{children}</StatusContent>
    </Status>
  );
}
