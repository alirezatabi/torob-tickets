import type { TripQuery } from "@/domain/trip";
import type { OfferGroup } from "@/domain/flight";
import { runSearch, type SearchOutcome } from "@/providers/search";
import { groupOffers } from "@/dedupe/group";
import { buildFlightResults, type FlightResult, type FlightResults } from "@/modules/search/results";
import { SORT_LABELS as FLIGHT_SORT_LABELS, type SortKey } from "@/ranking/score";

/**
 * Server-side façade the pages use. Kept separate from the pipeline so pages never
 * import provider internals, and so the same function backs the API route.
 *
 * The unit it returns is a **flight** (`FlightResult`), not an offer: one card per physical
 * flight, carrying its cheapest purchasable price and every seller's price underneath.
 */

export interface SearchResultView {
  outcome: SearchOutcome;
  /** Ranked + sorted flights, one entry per physical flight. */
  results: FlightResults;
  flights: FlightResult[];
  /** Groups in flight order — used by the filter sidebar and the compare tray. */
  groups: OfferGroup[];
  sort: SortKey;
  sortLabel: string;
}

export async function searchTrips(
  query: TripQuery,
  sort: SortKey,
  options: { now?: Date } = {},
): Promise<SearchResultView> {
  const outcome = await runSearch(query, options.now ? { now: options.now } : {});
  return viewFromOutcome(outcome, query, sort);
}

/** Same view from an already-fetched outcome (the live pipeline reuses this). */
export function viewFromOutcome(outcome: SearchOutcome, query: TripQuery, sort: SortKey): SearchResultView {
  const groups = groupOffers(outcome.offers);
  const results = buildFlightResults(groups, query, {
    passengers: query.passengers,
    cabin: query.cabin,
    sort,
  });
  results.health = outcome.health;
  results.issues = outcome.issues;
  return {
    outcome,
    results,
    flights: results.flights,
    groups: results.flights.map((flight) => flight.group),
    sort,
    sortLabel: FLIGHT_SORT_LABELS[sort],
  };
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
