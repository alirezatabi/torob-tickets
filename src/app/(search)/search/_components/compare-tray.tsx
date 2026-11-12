"use client";

import Link from "next/link";
import { ArrowLeft, X } from "lucide-react";
import type { OfferGroup } from "@/domain/flight";
import type { TripQuery } from "@/domain/trip";
import { formatDurationShort, formatToman, toPersianDigits } from "@/lib/format";
import { toSearchParams } from "@/lib/search-params";

/**
 * Floating selection tray. Keeps the compare action reachable while scrolling and
 * explains the limit instead of silently ignoring a 4th selection.
 */
export function CompareTray({
  groups,
  selected,
  query,
  onRemove,
}: {
  groups: OfferGroup[];
  selected: { groupKey: string; offerId: string }[];
  query: TripQuery;
  onRemove: (offerId: string) => void;
}) {
  if (selected.length === 0) return null;

  const items = selected
    .map((entry) => {
      const group = groups.find((candidate) => candidate.groupKey === entry.groupKey);
      const offer = group?.offers.find((candidate) => candidate.id === entry.offerId);
      return group && offer ? { group, offer } : null;
    })
    .filter((item): item is { group: OfferGroup; offer: OfferGroup["primary"] } => item !== null);

  if (items.length === 0) return null;

  const params = toSearchParams(query);
  params.set("groups", selected.map((entry) => `${entry.groupKey}:${entry.offerId}`).join(","));

  return (
    <div data-compare-tray className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="text-[0.7rem] font-semibold text-ink-600">مقایسه ({toPersianDigits(items.length)} از ۳)</span>
          {items.map(({ group, offer }) => (
            <span
              key={offer.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2 py-1 text-[0.65rem] text-ink-700"
            >
              <span className="font-medium">{offer.airlineName}</span>
              <span className="nums text-ink-500">{formatToman(group.cheapestToman)}</span>
              <span className="text-ink-400">{formatDurationShort(offer.durationMinutes)}</span>
              <button
                type="button"
                onClick={() => onRemove(offer.id)}
                className="rounded p-0.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                aria-label={`حذف ${offer.airlineName} از مقایسه`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {items.length === 1 && (
            <span className="hidden text-[0.65rem] text-ink-400 sm:inline">یک گزینهٔ دیگر اضافه کنید تا مقایسه کنیم.</span>
          )}
          <Link
            href={`/compare?${params.toString()}`}
            aria-disabled={items.length < 2}
            className={
              items.length < 2
                ? "btn-ghost pointer-events-none text-[0.72rem] opacity-50"
                : "btn-primary text-[0.72rem]"
            }
          >
            مقایسهٔ گزینه‌ها
            <ArrowLeft className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}
