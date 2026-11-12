import type { FlightOffer } from "@/domain/flight";
import { hardConstraintViolations, rankInputs } from "@/modules/ranking/core";
import { fromDemoOffer } from "@/modules/ranking/project";
import type { QueryPreferences, TripQuery } from "@/domain/trip";
import { getCity } from "@/lib/cities";
import { hourInZone, isoDateInZone } from "@/lib/format";

/**
 * Deterministic ranking.
 *
 * Design rules:
 *  - an LLM never influences the score (it may only explain it),
 *  - every sub-score is a bounded, documented transform of real offer data,
 *  - weights come from the structured intent, so the same data + same intent
 *    always produces the identical ranking (testable).
 *
 * `score` is 0–100, higher is better.
 */

export type ScoreFactor =
  | "price"
  | "duration"
  | "stops"
  | "baggage"
  | "refund"
  | "timeOfDay"
  | "airline";

export const FACTOR_LABELS: Record<ScoreFactor, string> = {
  price: "قیمت",
  duration: "مدت سفر",
  stops: "تعداد توقف",
  baggage: "بار همراه",
  refund: "شرایط استرداد",
  timeOfDay: "زمان پرواز",
  airline: "ایرلاین درخواستی",
};

export type Weights = Record<ScoreFactor, number>;

export interface ScoredOffer {
  offer: FlightOffer;
  score: number;
  /** True when the offer violates a stated hard constraint. */
  feasible: boolean;
  /** Human-readable Persian reasons behind the *hard* rejection. */
  violations: string[];
  contributions: Record<ScoreFactor, number>;
}

export interface RankedResult {
  ranked: ScoredOffer[];
  /** Offers that satisfy every hard constraint, best first. */
  feasible: ScoredOffer[];
  /** Offers that do not, still shown (never hidden) with the reason. */
  excluded: ScoredOffer[];
  cheapest: ScoredOffer | null;
  fastest: ScoredOffer | null;
  best: ScoredOffer | null;
  weights: Weights;
}

/** Base weights per price preference; explicit intent then nudges them. */
const BASE_WEIGHTS: Record<QueryPreferences["pricePreference"], Weights> = {
  // Explicitly documented, tunable defaults. Ratios matter, absolute values do not
  // (weights are renormalized after intent-specific adjustments).
  low: { price: 0.52, duration: 0.15, stops: 0.12, baggage: 0.07, refund: 0.04, timeOfDay: 0.06, airline: 0.04 },
  balanced: { price: 0.4, duration: 0.2, stops: 0.13, baggage: 0.11, refund: 0.06, timeOfDay: 0.06, airline: 0.04 },
  comfort: { price: 0.12, duration: 0.22, stops: 0.16, baggage: 0.18, refund: 0.09, timeOfDay: 0.07, airline: 0.04 },
};

/** Derive normalized weights (sum = 1) from the structured intent. */
export function deriveWeights(prefs: QueryPreferences): Weights {
  const weights: Weights = { ...BASE_WEIGHTS[prefs.pricePreference] };

  if (prefs.maxStops !== null) weights.stops += 0.06;
  if (prefs.baggageRequired) weights.baggage += 0.05;
  if (prefs.refundableOnly) weights.refund += 0.05;
  if (prefs.dayPart) weights.timeOfDay += 0.05;
  if (prefs.preferredAirlines.length > 0) weights.airline += 0.04;
  if (prefs.pricePreference === "low" && prefs.maxPriceToman !== null) weights.price += 0.04;

  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  for (const key of Object.keys(weights) as ScoreFactor[]) {
    weights[key] = weights[key] / total;
  }
  return weights;
}

/** Local departure hour in the origin's timezone — that is what the user experiences. */
export function localDepartureHour(offer: FlightOffer): number {
  return hourInZone(offer.departAt, getCity(offer.originCode)?.timezone ?? "Asia/Tehran");
}

/** Hard constraints — violating one makes an offer "outside your preferences". */
export function hardConstraints(offer: FlightOffer, prefs: QueryPreferences): string[] {
  // Delegated: the shared core owns the constraint definitions so demo and live offers
  // can never diverge on what "out of scope" means.
  return hardConstraintViolations(fromDemoOffer(offer), prefs);
}

/**
 * Rank offers for a query.
 *
 * Sub-scores are min–max normalized *within the candidate set*, which keeps the
 * ranking meaningful per search (a 4M toman ticket is only "cheap" relative to the
 * others on that route/date — and the explanation says so).
 */
export function rankOffers(offers: FlightOffer[], prefs: QueryPreferences): RankedResult {
  const weights = deriveWeights(prefs);

  if (offers.length === 0) {
    return { ranked: [], feasible: [], excluded: [], cheapest: null, fastest: null, best: null, weights };
  }

  // One scorer for demo and live data: project → shared core → project back.
  const byId = new Map(offers.map((offer) => [offer.id, offer]));
  const core = rankInputs(offers.map((offer) => fromDemoOffer(offer)), prefs);

  const scored: ScoredOffer[] = core.ranked.map((entry) => {
    const offer = byId.get(entry.input.id);
    if (!offer) throw new Error(`rank core returned unknown id ${entry.input.id}`);
    const contributions = {
      price: entry.factors.price?.weighted ?? 0,
      duration: entry.factors.duration?.weighted ?? 0,
      stops: entry.factors.stops?.weighted ?? 0,
      baggage: entry.factors.baggage?.weighted ?? 0,
      refund: entry.factors.refund?.weighted ?? 0,
      timeOfDay: entry.factors.timeOfDay?.weighted ?? 0,
      airline: entry.factors.airline?.weighted ?? 0,
    } satisfies Record<ScoreFactor, number>;

    return {
      offer,
      score: entry.score,
      feasible: entry.feasible,
      violations: entry.violations,
      contributions,
    };
  });

  const feasible = scored.filter((entry) => entry.feasible);
  const excluded = scored.filter((entry) => !entry.feasible);
  const pool = feasible.length > 0 ? feasible : scored;

  const cheapest = [...pool].sort((a, b) => a.offer.price.toman - b.offer.price.toman)[0] ?? null;
  const fastest = [...pool].sort((a, b) => a.offer.durationMinutes - b.offer.durationMinutes)[0] ?? null;

  return { ranked: scored, feasible, excluded, cheapest, fastest, best: scored[0] ?? null, weights };
}

/**
 * The four tabs are genuinely different orders, and every one of them ends in a
 * deterministic tie-break (`providerId`-free: price → duration → departure → id) so the same
 * data always produces the same page, on any machine.
 */
export type SortKey = "best" | "cheapest" | "earliest" | "fastest";

export const SORT_LABELS: Record<SortKey, string> = {
  best: "بهترین تطابق",
  cheapest: "ارزان‌ترین",
  earliest: "زودترین حرکت",
  fastest: "سریع‌ترین",
};

function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Stable, locale-independent tie-break shared by every sort mode. */
export function compareStable(a: ScoredOffer, b: ScoredOffer): number {
  if (a.offer.price.toman !== b.offer.price.toman) return a.offer.price.toman - b.offer.price.toman;
  if (a.offer.durationMinutes !== b.offer.durationMinutes) return a.offer.durationMinutes - b.offer.durationMinutes;
  const departure = new Date(a.offer.departAt).getTime() - new Date(b.offer.departAt).getTime();
  if (departure !== 0) return departure;
  return byCodePoint(a.offer.id, b.offer.id);
}

/** Apply a user-chosen sort to the ranked candidates (stable and explicit). */
export function sortScored(scored: ScoredOffer[], key: SortKey): ScoredOffer[] {
  const copy = [...scored];
  if (key === "cheapest") {
    return copy.sort((a, b) => a.offer.price.toman - b.offer.price.toman || compareStable(a, b));
  }
  if (key === "fastest") {
    return copy.sort((a, b) => a.offer.durationMinutes - b.offer.durationMinutes || compareStable(a, b));
  }
  if (key === "earliest") {
    return copy.sort(
      (a, b) =>
        new Date(a.offer.departAt).getTime() - new Date(b.offer.departAt).getTime() || compareStable(a, b),
    );
  }
  return copy.sort((a, b) => (a.feasible !== b.feasible ? (a.feasible ? -1 : 1) : b.score - a.score || compareStable(a, b)));
}

/** Hour/day-part of an offer in the origin timezone, for filters and UI labels. */
export function departureContext(offer: FlightOffer): { hour: number; dateIso: string } {
  const tz = getCity(offer.originCode)?.timezone ?? "Asia/Tehran";
  return { hour: hourInZone(offer.departAt, tz), dateIso: isoDateInZone(offer.departAt, tz) };
}

/**
 * True when the offer departs on the requested **local** day at the origin airport.
 * This is the only correct reading of "the flight on 29 Aban": a 00:30 Tehran departure is
 * that day in Tehran even though it is the previous day in UTC.
 */
export function tripMatchesOfferDate(query: TripQuery, offer: FlightOffer): boolean {
  return departureContext(offer).dateIso === query.departDate;
}

/**
 * Already-past departures inside today's list.
 *
 * Tickets cannot be sold up to the minute of departure, so "today" hides anything that
 * departs within `SALES_CUTOFF_MINUTES`; it is a named constant so the UI and the tests
 * agree on the same rule.
 */
export const SALES_CUTOFF_MINUTES = 90;

export function isWithinSalesWindow(offer: FlightOffer, now: Date, cutoffMinutes = SALES_CUTOFF_MINUTES): boolean {
  return new Date(offer.departAt).getTime() - now.getTime() >= cutoffMinutes * 60_000;
}
