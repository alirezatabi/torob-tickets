import type { FlightOffer, OfferGroup } from "@/domain/flight";
import type { TripQuery } from "@/domain/trip";
import type { NormalizationIssue, ProviderHealth } from "@/providers/types";
import { selectCheapestOffer, type CheapestSelection, type IneligibleOffer } from "@/modules/pricing/select-cheapest";
import { rankInputs, type RankCoreResult, type RankWeights } from "@/modules/ranking/core";
import { fromGroup } from "@/modules/ranking/project";
import type { RankInput, ScoredRankInput } from "@/modules/ranking/types";
import type { ScoredOffer } from "@/ranking/score";

/**
 * The flight-level result of a search — the shape every surface renders.
 *
 * Pipeline (prompt 02 §4.3):
 *
 *   search → normalize → dedupe/group (Flight) → selectCheapestOffer
 *          → rank the **Flight** → sort → render
 *
 * The old order ranked individual offers and then picked "the first ranked offer" of each
 * group, which (a) could show a price that was not the cheapest, and (b) made the seller
 * count in the ranking always 1. Ranking a `FlightResult` fixes both by construction: the
 * price is `selection.cheapest.price.toman` and the seller count is the group's.
 */

export type FlightSortKey = "best" | "cheapest" | "earliest" | "fastest";

export interface FlightResult {
  group: OfferGroup;
  /** Cheapest purchasable offer + everything that lost, with reasons. */
  selection: CheapestSelection;
  /** The offer the card leads with; equals `selection.cheapest` or the group's primary. */
  display: FlightOffer;
  /** Score of the flight (from `rankInputs`), never of a single seller row. */
  score: number;
  feasible: boolean;
  violations: string[];
  /** Sold out for this passenger count: shown greyed as «تکمیل ظرفیت», sorted last. */
  soldOut: boolean;
  /** Every seller, cheapest first, with the delta from the cheapest (Persian-ready). */
  sellers: { offer: FlightOffer; deltaToman: number; cheapest: boolean }[];
  /** Offers excluded from the comparison, with reasons. */
  ineligible: IneligibleOffer[];
}

/**
 * A **projection** of a ranked flight onto the legacy `ScoredOffer` shape.
 *
 * The explanation, the comparison tray and the compare page were written against per-offer
 * scores. Rather than compute a second (and possibly different) score there, they receive this
 * projection: the price, duration and carrier of the flight's cheapest purchasable offer, with
 * the flight's own score and violations. One scorer, one number.
 */
export function scoredOfferOf(flight: FlightResult): ScoredOffer {
  return {
    offer: flight.selection.cheapest ?? flight.display,
    score: flight.score,
    feasible: flight.feasible,
    violations: flight.violations,
    contributions: {
      price: 0,
      duration: 0,
      stops: 0,
      baggage: 0,
      refund: 0,
      timeOfDay: 0,
      airline: 0,
    },
  };
}

/** The ranked shape the explanation card consumes. */
export interface RankedView {
  ranked: ScoredOffer[];
  feasible: ScoredOffer[];
  excluded: ScoredOffer[];
  cheapest: ScoredOffer | null;
  fastest: ScoredOffer | null;
  best: ScoredOffer | null;
  weights: RankWeights;
}

/** The projection must not depend on the tab the user picked (the score does not). */
export function rankedView(flights: FlightResult[], weights: RankWeights): RankedView {
  const scored = flights.filter((flight) => !flight.soldOut).map(scoredOfferOf);
  const feasible = scored.filter((entry) => entry.feasible);
  const cheapest = scored.reduce<ScoredOffer | null>(
    (best, entry) => (best === null || entry.offer.price.toman < best.offer.price.toman ? entry : best),
    null,
  );
  const fastest = scored.reduce<ScoredOffer | null>(
    (best, entry) => (best === null || entry.offer.durationMinutes < best.offer.durationMinutes ? entry : best),
    null,
  );
  const ranked0 = [...scored].sort((a, b) => b.score - a.score);
  return {
    ranked: ranked0,
    feasible,
    excluded: scored.filter((entry) => !entry.feasible),
    cheapest,
    fastest,
    best: ranked0[0] ?? null,
    weights,
  };
}

export interface FlightResults {
  flights: FlightResult[];
  health: ProviderHealth[];
  issues: NormalizationIssue[];
  /** Ranked inputs, for the recommendation card and the explanation. */
  ranked: RankCoreResult;
  /** Ranked flights projected onto the legacy per-offer shape (one scorer, no re-ranking). */
  rankedView: RankedView;
  offers: FlightOffer[];
  groups: OfferGroup[];
}

export interface BuildOptions {
  passengers: number;
  cabin: TripQuery["cabin"];
  sort: FlightSortKey;
}

/** Deterministic, locale-independent tie-breaks shared by all four sorts. */
function stable(a: FlightResult, b: FlightResult): number {
  const priceA = a.selection.cheapest?.price.toman ?? Number.MAX_SAFE_INTEGER;
  const priceB = b.selection.cheapest?.price.toman ?? Number.MAX_SAFE_INTEGER;
  if (priceA !== priceB) return priceA - priceB;
  const depA = new Date(a.display.departAt).getTime();
  const depB = new Date(b.display.departAt).getTime();
  if (depA !== depB) return depA - depB;
  return a.group.groupKey < b.group.groupKey ? -1 : a.group.groupKey > b.group.groupKey ? 1 : 0;
}

/** Sold out last; everything else according to the requested tab. */
export function sortFlights(flights: FlightResult[], sort: FlightSortKey): FlightResult[] {
  const copy = [...flights];
  return copy.sort((a, b) => {
    if (a.soldOut !== b.soldOut) return a.soldOut ? 1 : -1;
    if (sort === "best" && a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    if (sort === "best") {
      const byScore = b.score - a.score;
      if (Math.abs(byScore) > 0.5) return byScore;
      return stable(a, b);
    }
    if (sort === "cheapest") return stable(a, b);
    if (sort === "fastest") {
      const byDuration = a.display.durationMinutes - b.display.durationMinutes;
      if (byDuration !== 0) return byDuration;
      return stable(a, b);
    }
    const byDeparture = new Date(a.display.departAt).getTime() - new Date(b.display.departAt).getTime();
    if (byDeparture !== 0) return byDeparture;
    return stable(a, b);
  });
}

/**
 * Build the renderable, ranked flight list from grouped offers.
 * Pure and synchronous: the caller owns fetching, this owns meaning.
 */
export function buildFlightResults(
  groups: OfferGroup[],
  query: TripQuery,
  options: BuildOptions,
): FlightResults {
  const prepared = groups.map((group) => {
    const selection = selectCheapestOffer(group, {
      passengers: options.passengers,
      cabin: options.cabin,
    });
    // When nothing is purchasable the card still shows the flight, greyed, using the
    // group's own primary row — never an invented price.
    const display = selection.cheapest ?? group.primary;
    return { group, selection, display };
  });

  const inputs: RankInput[] = prepared
    .filter((entry) => entry.selection.cheapest !== null)
    .map((entry) =>
      fromGroup(entry.group, entry.selection.cheapest as FlightOffer, {
        sellerCount: entry.group.providers.length,
        sellerFloor: entry.group.knownSellers,
      }),
    );

  const ranked = rankInputs(inputs, query.filters);
  const scoreById = new Map<string, ScoredRankInput>(ranked.ranked.map((entry) => [entry.input.id, entry]));

  const flights: FlightResult[] = prepared.map(({ group, selection, display }) => {
    const scored = selection.cheapest ? scoreById.get(selection.cheapest.id) : undefined;
    const cheapestPrice = selection.cheapest?.price.toman ?? null;
    const sellers = group.offers
      .filter((offer) => offer.price.comparable !== false)
      .sort((a, b) => a.price.toman - b.price.toman || (a.providerId < b.providerId ? -1 : 1))
      .map((offer) => ({
        offer,
        deltaToman: cheapestPrice === null ? 0 : offer.price.toman - cheapestPrice,
        cheapest: selection.cheapest !== null && offer.id === selection.cheapest.id,
      }));

    return {
      group,
      selection,
      display,
      score: scored?.score ?? 0,
      feasible: scored?.feasible ?? selection.cheapest !== null,
      violations: scored?.violations ?? [],
      soldOut: selection.cheapest === null,
      sellers,
      ineligible: selection.ineligible,
    };
  });

  const sorted = sortFlights(flights, options.sort);
  return {
    flights: sorted,
    health: [],
    issues: [],
    ranked,
    rankedView: rankedView(sorted, ranked.weights),
    offers: groups.flatMap((group) => group.offers),
    groups,
  };
}
