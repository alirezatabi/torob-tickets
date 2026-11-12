"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { TripQuery } from "@/domain/trip";
import type { FlightResult } from "@/modules/search/results";
import { selectCheapestOffer } from "@/modules/pricing/select-cheapest";
import { filterGroups, type DisplayFilters } from "@/lib/filter";
import { toPersianDigits } from "@/lib/format";
import { OfferCard } from "./offer-card";
import { CompareTray } from "./compare-tray";

/**
 * Client wrapper: owns the compare selection (max 3) and the «خارج از ترجیحات» toggle.
 *
 * It renders **flights**, not offers: one card per physical flight, in the order the server
 * produced (the requested sort), and it never re-sorts them — that was B2, where the tabs
 * changed the URL while the list stayed price-ordered.
 *
 * Filters can hide a flight, so the cheapest price is recomputed *after* filtering with the
 * same `selectCheapestOffer` the server uses; nothing here invents a price.
 */
export function ResultsList({
  query,
  flights,
}: {
  query: TripQuery;
  flights: FlightResult[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [showExcluded, setShowExcluded] = useState(true);

  const filters: DisplayFilters = query.filters;
  const { visible, hidden } = useMemo(
    () => filterGroups(flights.map((flight) => flight.group), filters),
    [flights, filters],
  );

  /**
   * Filtering may remove sellers from a flight (an airline/price/stops filter is applied per
   * offer), so the flight's cheapest price is recomputed on the surviving sellers — with the
   * same `selectCheapestOffer` the server used. A flight whose sellers are all filtered out
   * simply disappears; nothing here re-sorts the list.
   */
  const filtered = useMemo(() => {
    const visibleByKey = new Map(visible.map((group) => [group.groupKey, group]));
    return flights.flatMap((flight) => {
      const group = visibleByKey.get(flight.group.groupKey);
      if (!group) return [];
      const selection = selectCheapestOffer(group, { passengers: query.passengers, cabin: query.cabin });
      return [{ ...flight, group, selection, soldOut: selection.cheapest === null }];
    });
  }, [flights, visible, query.passengers, query.cabin]);

  // The URL is the source of truth, but we keep an optimistic copy so several
  // selections in a row work even before the server round-trip lands.
  const urlCompare = searchParams.get("compare") ?? "";
  const [selection, setSelection] = useState(() => parseSelection(urlCompare));
  useEffect(() => {
    setSelection(parseSelection(urlCompare));
  }, [urlCompare]);

  const compareIdOf = (flight: FlightResult) => flight.selection.cheapest?.id ?? flight.display.id;

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

  const ranked = filtered.filter((flight) => !flight.soldOut && (flight.feasible || !showExcluded));
  const excluded = filtered.filter((flight) => !flight.soldOut && !flight.feasible);
  const soldOut = filtered.filter((flight) => flight.soldOut);

  const card = (flight: FlightResult, index: number, muted = false, locked = false) => {
    const offerId = compareIdOf(flight);
    const selected = selection.some((item) => item.offerId === offerId);
    return (
      <OfferCard
        key={flight.group.groupKey}
        flight={flight}
        query={query}
        index={index}
        muted={muted}
        selected={selected}
        onToggleCompare={() => toggleCompare(flight.group.groupKey, offerId)}
        compareDisabled={locked || (selection.length >= 3 && !selected)}
      />
    );
  };

  return (
    <div>
      <div className="space-y-3" data-testid="results-list">
        {ranked.map((flight, index) => card(flight, index))}
      </div>

      {ranked.length === 0 && soldOut.length === 0 && (
        <div className="card p-8 text-center">
          <h2 className="text-sm font-bold">با این فیلترها نتیجه‌ای نماند</h2>
          <p className="mt-2 text-xs leading-6 text-ink-500">فیلترها را کم کنید یا «پاک کردن» را بزنید.</p>
        </div>
      )}

      {excluded.length > 0 && (
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
                {toPersianDigits(excluded.length)}
              </span>
            </span>
            {showExcluded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>

          {showExcluded && <div className="mt-3 space-y-3">{excluded.map((flight, index) => card(flight, index, true, true))}</div>}
        </section>
      )}

      {/* Sold out flights stay visible — they are facts about the route — but always last. */}
      {soldOut.length > 0 && (
        <section className="mt-5" aria-label="پروازهای تکمیل ظرفیت">
          <p className="mb-2 text-[0.7rem] font-semibold text-ink-500">
            تکمیل ظرفیت برای {toPersianDigits(query.passengers)} مسافر
          </p>
          <div className="space-y-3">{soldOut.map((flight, index) => card(flight, index, true, true))}</div>
        </section>
      )}

      {hidden > 0 && (
        <p className="mt-4 text-center text-[0.68rem] text-ink-400">
          {toPersianDigits(hidden)} پرواز با فیلترها پنهان شد.
        </p>
      )}

      <CompareTray
        groups={filtered.map((flight) => flight.group)}
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

export function ResultsCount({ value }: { value: number }) {
  return <span className="text-[0.7rem] text-ink-500">{toPersianDigits(value)}</span>;
}
