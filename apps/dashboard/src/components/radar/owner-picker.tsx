"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@openstatus/ui/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@openstatus/ui/components/ui/popover";
import { useDebounce } from "@openstatus/ui/hooks/use-debounce";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { useTRPC } from "@/lib/trpc/client";

export type RadarOwnerCandidate = {
  userId: number;
  workspaceId: number;
  email: string;
  name: string | null;
  verificationStatus: "unverified" | "pending" | "verified" | "rejected";
  providerLimit: number | null;
  ownedCount: number;
  pendingClaimCount: number;
  providerUsage: number;
};

type RadarOwnerPickerProps = {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  onCandidateChange?: (candidate: RadarOwnerCandidate | null) => void;
  currentOwnerUserId?: number | null;
  selectedLabel?: string;
  disabled?: boolean;
};

const PLATFORM_VALUE = "platform";
const SEARCH_LIMIT = 20;

function candidateLabel(candidate: RadarOwnerCandidate) {
  return candidate.name
    ? `${candidate.name} · ${candidate.email}`
    : candidate.email;
}

export function RadarOwnerPicker({
  id = "radar-owner",
  value,
  onValueChange,
  onCandidateChange,
  currentOwnerUserId,
  selectedLabel,
  disabled = false,
}: RadarOwnerPickerProps) {
  const t = useTranslations("radar");
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search.trim(), 350);
  const searchQuery = debouncedSearch.length >= 2 ? debouncedSearch : "";
  const selectedUserId =
    value === PLATFORM_VALUE ? undefined : Number(value) || undefined;
  const shouldFetch =
    open && (searchQuery.length >= 2 || selectedUserId != null);
  const ownerCandidatesQuery = trpc.radar.ownerCandidates.queryOptions({
    query: searchQuery,
    limit: SEARCH_LIMIT,
    selectedUserId,
  });
  const { data: candidates = [], isFetching } = useQuery({
    ...ownerCandidatesQuery,
    enabled: shouldFetch,
  });
  const uniqueCandidates = useMemo(
    () =>
      Array.from(
        new Map(
          candidates.map((candidate) => [candidate.userId, candidate]),
        ).values(),
      ) as RadarOwnerCandidate[],
    [candidates],
  );
  const selectedCandidate = uniqueCandidates.find(
    (candidate) => String(candidate.userId) === value,
  );
  const searchCandidates = useMemo(() => {
    if (!searchQuery) return uniqueCandidates;
    const normalizedQuery = searchQuery.toLocaleLowerCase();
    return uniqueCandidates.filter((candidate) =>
      candidateLabel(candidate).toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [searchQuery, uniqueCandidates]);
  const triggerLabel =
    value === PLATFORM_VALUE
      ? t("platformManagedOption")
      : selectedCandidate
        ? candidateLabel(selectedCandidate)
        : (selectedLabel ?? t("ownerSearchSelected"));

  function selectPlatform() {
    onValueChange(PLATFORM_VALUE);
    onCandidateChange?.(null);
    setSearch("");
    setOpen(false);
  }

  function selectCandidate(candidate: RadarOwnerCandidate) {
    onValueChange(String(candidate.userId));
    onCandidateChange?.(candidate);
    setSearch("");
    setOpen(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) setSearch("");
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate text-left">{triggerLabel}</span>
          <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={t("ownerSearchPlaceholder")}
          />
          <CommandList className="max-h-72">
            <CommandGroup>
              <CommandItem value={PLATFORM_VALUE} onSelect={selectPlatform}>
                <Check
                  className={
                    value === PLATFORM_VALUE ? "opacity-100" : "opacity-0"
                  }
                />
                {t("platformManagedOption")}
              </CommandItem>
            </CommandGroup>
            {search.trim().length < 2 ? (
              <div className="text-muted-foreground px-3 py-4 text-center text-xs">
                {t("ownerSearchHint")}
              </div>
            ) : search.trim() !== debouncedSearch ? (
              <div className="text-muted-foreground flex items-center justify-center gap-2 px-3 py-4 text-xs">
                <Loader2 className="size-3.5 animate-spin" />
                {t("ownerSearchWaiting")}
              </div>
            ) : isFetching && searchCandidates.length === 0 ? (
              <div className="text-muted-foreground flex items-center justify-center gap-2 px-3 py-4 text-xs">
                <Loader2 className="size-3.5 animate-spin" />
                {t("ownerSearchLoading")}
              </div>
            ) : searchCandidates.length === 0 ? (
              <div className="text-muted-foreground px-3 py-4 text-center text-xs">
                {t("ownerSearchNoResults")}
              </div>
            ) : (
              <CommandGroup>
                {searchCandidates.map((candidate) => {
                  const atLimit =
                    candidate.providerLimit != null &&
                    candidate.providerUsage >= candidate.providerLimit &&
                    candidate.userId !== currentOwnerUserId;
                  return (
                    <CommandItem
                      key={candidate.userId}
                      value={String(candidate.userId)}
                      disabled={atLimit}
                      onSelect={() => selectCandidate(candidate)}
                    >
                      <Check
                        className={
                          String(candidate.userId) === value
                            ? "opacity-100"
                            : "opacity-0"
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {candidateLabel(candidate)}
                      </span>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {candidate.providerLimit == null
                          ? t("unlimited")
                          : `${candidate.providerUsage}/${candidate.providerLimit}`}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
