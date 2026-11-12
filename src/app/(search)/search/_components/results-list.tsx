"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { OfferGroup } from "@/domain/flight";
import type { TripQuery } from "@/domain/trip";
import type { ScoredOffer } from "@/ranking/score";
import { filterGroups, type DisplayFilters } from "@/lib/filter";
import { toPersianDigits } from "@/lib/format";
import { cn } from "@/lib/cn";
import { OfferCard } from "./offer-card";
import { CompareTray } from "./compare-tray";

/**
 * Client wrapper: owns the compare selection (max 3) and the "show excluded"
 * toggle. Filtering itself mirrors the server rules via `lib/filter`.
 */
export function ResultsList({
  query,
  groups,
  ranked,
}: {
  query: TripQuery;
  groups: OfferGroup[];
  ranked: ScoredOffer[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [showExcluded, setShowExcluded] = useState(true);

  const filters: DisplayFilters = query.filters;
  const { visible, hidden } = useMemo(() => filterGroups(groups, filters), [groups, filters]);

  const scoreById = useMemo(() => new Map(ranked.map((item) => [item.offer.id, item])), [ranked]);

  // The URL is the source of truth, but we keep an optimistic copy so several
  // selections in a row work even before the server round-trip lands.
  const urlCompare = searchParams.get("compare") ?? "";
  const [selection, setSelection] = useState(() => parseSelection(urlCompare));
  useEffect(() => {
    setSelection(parseSelection(urlCompare));
  }, [urlCompare]);

  function toggleCompare(groupKey: string, offerId: string) {
    const exists = selection.some((item) => item.offerId === offerId);
    const next = exists
      ? selection.filter((item) => item.offerId !== offerId)
      : [...selection, { groupKey, offerId }].slice(-3);

    setSelection(next);

    const params = new URLSearchParams(searchParams.toString());
    if (next.length === 0) params.delete("compare");
    else params.set("compare", next.map((item) => `${item.groupKey}:${item.offerId}`).join(","));
    startTransition(() => router.replace(`/search?${params.toString()}`, { scroll: false }));
  }


  const feasibleGroups = visible.filter((group) => isGroupFeasible(group, scoreById));
  const excludedGroups = visible.filter((group) => !isGroupFeasible(group, scoreById));

  return (
    <div>
      <div className="space-y-3" data-testid="results-list">
        {feasibleGroups.map((group, index) => (
          <OfferCard
            key={group.groupKey}
            group={group}
            scored={scoreById.get(group.primary.id) ?? null}
            index={index}
            selected={selection.some((item) => item.offerId === group.primary.id)}
            onToggleCompare={() => toggleCompare(group.groupKey, group.primary.id)}
            compareDisabled={
              selection.length >= 3 && !selection.some((item) => item.offerId === group.primary.id)
            }
          />
        ))}
      </div>

      {feasibleGroups.length === 0 && (
        <div className="card p-8 text-center">
          <h2 className="text-sm font-bold">با این فیلترها نتیجه‌ای نماند</h2>
          <p className="mt-2 text-xs leading-6 text-ink-500">فیلترها را کم کنید یا «پاک کردن» را بزنید.</p>
        </div>
      )}

      {excludedGroups.length > 0 && (
        <section className="mt-5" aria-labelledby="excluded-heading">
          <button
            type="button"
            onClick={() => setShowExcluded((value) => !value)}
            aria-expanded={showExcluded}
            className="flex w-full items-center justify-between rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-right text-[0.72rem] font-semibold text-ink-600 hover:bg-ink-50"
          >
            <span id="excluded-heading" className="inline-flex items-center gap-1.5">
              خارج از ترجیحات
              <span className="rounded-full bg-ink-100 px-1.5 text-[0.65rem] font-semibold text-ink-500">
                {toPersianDigits(excludedGroups.length)}
              </span>
            </span>
            {showExcluded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>

          {showExcluded && (
            <div className="mt-3 space-y-3">
              {excludedGroups.map((group, index) => (
                <OfferCard
                  key={group.groupKey}
                  group={group}
                  scored={scoreById.get(group.primary.id) ?? null}
                  index={index}
                  muted
                  selected={selection.some((item) => item.offerId === group.primary.id)}
                  onToggleCompare={() => toggleCompare(group.groupKey, group.primary.id)}
                  compareDisabled
                />
              ))}
            </div>
          )}
        </section>
      )}

      {hidden > 0 && (
        <p className="mt-4 text-center text-[0.68rem] text-ink-400">
          {toPersianDigits(hidden)} پرواز با فیلترها پنهان شد.
        </p>
      )}

      <CompareTray
        groups={groups}
        selected={selection}
        query={query}
        onRemove={(offerId) => {
          const item = selection.find((entry) => entry.offerId === offerId);
          if (item) toggleCompare(item.groupKey, item.offerId);
        }}
      />
    </div>
  );
}

function parseSelection(value: string): { groupKey: string; offerId: string }[] {
  if (!value) return [];
  return value
    .split(",")
    .map((token) => token.split(":"))
    .filter((parts) => parts.length === 2 && parts[0] && parts[1])
    .map((parts) => ({ groupKey: parts[0] as string, offerId: parts[1] as string }));
}

function isGroupFeasible(group: OfferGroup, scoreById: Map<string, ScoredOffer>): boolean {
  const scored = scoreById.get(group.primary.id);
  return scored ? scored.feasible : true;
}

export function ResultsCount({ value }: { value: number }) {
  return <span className={cn("text-[0.7rem] text-ink-500")}>{toPersianDigits(value)}</span>;
}
