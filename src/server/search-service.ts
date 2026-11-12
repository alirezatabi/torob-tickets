import type { TripQuery } from "@/domain/trip";
import type { OfferGroup } from "@/domain/flight";
import { runSearch, prepareResultList, type SearchOutcome } from "@/providers/search";
import { rankOffers, SORT_LABELS, type SortKey } from "@/ranking/score";

/**
 * Server-side façade the pages use. Kept separate from the pipeline so pages never
 * import provider internals, and so the same function can back an API route later.
 */

export interface SearchResultView {
  outcome: SearchOutcome;
  groups: OfferGroup[];
  sort: SortKey;
  sortLabel: string;
}

export async function searchTrips(query: TripQuery, sort: SortKey): Promise<SearchResultView> {
  const outcome = await runSearch(query);
  const { groups } = prepareResultList(outcome, sort);
  return { outcome, groups, sort, sortLabel: SORT_LABELS[sort] };
}

export interface CompareItem {
  groupKey: string;
  offerId: string;
}

export function parseCompareParam(value: string | undefined): CompareItem[] {
  if (!value) return [];
  return value
    .split(",")
    .map((token) => token.split(":"))
    .filter((parts) => parts.length === 2 && parts[0] && parts[1])
    .map((parts) => ({ groupKey: parts[0] as string, offerId: parts[1] as string }))
    .slice(0, 3);
}

export function serializeCompareParam(items: CompareItem[]): string {
  return items.map((item) => `${item.groupKey}:${item.offerId}`).join(",");
}

/** Rank a fixed set of offers to explain the comparison honestly. */
export function rankForComparison(query: TripQuery, offers: Parameters<typeof rankOffers>[0]) {
  return rankOffers(offers, query.filters);
}
