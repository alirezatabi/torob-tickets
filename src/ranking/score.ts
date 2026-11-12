import type { FlightOffer } from "@/domain/flight";
import { DAY_PART_RANGES, type QueryPreferences, type TripQuery } from "@/domain/trip";
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

/**
 * Lower is better, scored as `best / value` (1 for the best offer, 0.5 for one
 * that costs twice as much).
 *
 * Ratio scaling is used instead of min–max because a single outlier (e.g. a
 * business-class fare on the same route) would otherwise compress every economy
 * offer into the top of the range and make the ranking meaningless.
 */
function inverseRatio(value: number, best: number, exponent = 1): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (best <= 0) return 1;
  return Math.max(0, Math.min(1, Math.pow(best / value, exponent)));
}

/**
 * How steeply a higher fare is penalized. When the user explicitly asks for a cheap
 * trip, paying 15% more must actually cost ranking points, otherwise the "best"
 * pick silently ignores the stated intent.
 */
function priceCurve(preference: QueryPreferences["pricePreference"]): number {
  if (preference === "low") return 2;
  if (preference === "comfort") return 0.9;
  return 1.35;
}

function stopsScore(stops: number): number {
  if (stops === 0) return 1;
  if (stops === 1) return 0.55;
  if (stops === 2) return 0.22;
  return 0.05;
}

function baggageScore(offer: FlightOffer): number {
  if (offer.baggage.checked === "included") {
    // More kg is genuinely better, capped at 30 kg of useful signal.
    const kg = Math.min(offer.baggage.checkedKg ?? 20, 30);
    return 0.75 + (kg / 30) * 0.25;
  }
  if (offer.baggage.checked === "unknown") return 0.45;
  return 0.1;
}

function refundScore(offer: FlightOffer): number {
  if (offer.refundable === true) return 1;
  if (offer.refundable === null) return 0.35;
  return 0.1;
}

/** Local departure hour in the origin's timezone — that is what the user experiences. */
export function localDepartureHour(offer: FlightOffer): number {
  return hourInZone(offer.departAt, getCity(offer.originCode)?.timezone ?? "Asia/Tehran");
}

function timeOfDayScore(offer: FlightOffer, prefs: QueryPreferences): number {
  if (!prefs.dayPart) return 0.6;
  const [start, end] = DAY_PART_RANGES[prefs.dayPart];
  const hour = localDepartureHour(offer);
  if (hour >= start && hour < end) return 1;
  const distance = Math.min(Math.abs(hour - start), Math.abs(hour - end));
  if (distance <= 2) return 0.6;
  if (distance <= 4) return 0.35;
  return 0.15;
}

function airlineScore(offer: FlightOffer, prefs: QueryPreferences): number {
  if (prefs.preferredAirlines.length === 0) return 0.6;
  return prefs.preferredAirlines.includes(offer.airlineCode) ? 1 : 0.25;
}

/** Hard constraints — violating one makes an offer "outside your preferences". */
export function hardConstraints(offer: FlightOffer, prefs: QueryPreferences): string[] {
  const violations: string[] = [];
  if (prefs.maxStops !== null && offer.stops > prefs.maxStops) {
    violations.push(`${offer.stops} توقف دارد؛ حداکثر مجاز ${prefs.maxStops}`);
  }
  if (prefs.baggageRequired && offer.baggage.checked !== "included") {
    violations.push(
      offer.baggage.checked === "unknown" ? "وضعیت بار نامشخص است" : "بار همراه در نرخ نیست",
    );
  }
  if (prefs.refundableOnly && offer.refundable !== true) {
    violations.push(offer.refundable === null ? "شرایط استرداد نامشخص است" : "بلیت قابل استرداد نیست");
  }
  if (prefs.maxPriceToman !== null && offer.price.toman > prefs.maxPriceToman) {
    violations.push("گران‌تر از بودجهٔ اعلام‌شده");
  }
  if (prefs.dayPart) {
    const [start, end] = DAY_PART_RANGES[prefs.dayPart];
    const hour = localDepartureHour(offer);
    if (hour < start || hour >= end) violations.push("ساعت پرواز خارج از بازهٔ درخواستی است");
  }
  return violations;
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

  const prices = offers.map((o) => o.price.toman);
  const durations = offers.map((o) => o.durationMinutes);
  const minPrice = Math.min(...prices);
  const minDuration = Math.min(...durations);
  // Highest value is informative for the price filter, not for scoring.
  void Math.max(...prices);
  void Math.max(...durations);

  const scored: ScoredOffer[] = offers.map((offer) => {
    const contributions: Record<ScoreFactor, number> = {
      price: inverseRatio(offer.price.toman, minPrice, priceCurve(prefs.pricePreference)) * weights.price,
      duration: inverseRatio(offer.durationMinutes, minDuration, 1.15) * weights.duration,
      stops: stopsScore(offer.stops) * weights.stops,
      baggage: baggageScore(offer) * weights.baggage,
      refund: refundScore(offer) * weights.refund,
      timeOfDay: timeOfDayScore(offer, prefs) * weights.timeOfDay,
      airline: airlineScore(offer, prefs) * weights.airline,
    };
    const score = Object.values(contributions).reduce((a, b) => a + b, 0) * 100;
    const violations = hardConstraints(offer, prefs);

    return {
      offer,
      score: Math.round(score * 10) / 10,
      feasible: violations.length === 0,
      violations,
      contributions,
    };
  });

  const byScore = [...scored].sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    if (Math.abs(b.score - a.score) > 0.05) return b.score - a.score;
    if (a.offer.price.toman !== b.offer.price.toman) return a.offer.price.toman - b.offer.price.toman;
    return a.offer.durationMinutes - b.offer.durationMinutes;
  });

  const feasible = byScore.filter((s) => s.feasible);
  const excluded = byScore.filter((s) => !s.feasible);
  const pool = feasible.length > 0 ? feasible : byScore;

  const cheapest = [...pool].sort((a, b) => a.offer.price.toman - b.offer.price.toman)[0] ?? null;
  const fastest = [...pool].sort((a, b) => a.offer.durationMinutes - b.offer.durationMinutes)[0] ?? null;
  const best = byScore[0] ?? null;

  return { ranked: byScore, feasible, excluded, cheapest, fastest, best, weights };
}

export type SortKey = "best" | "cheapest" | "fastest";

export const SORT_LABELS: Record<SortKey, string> = {
  best: "بهترین تطابق",
  cheapest: "ارزان‌ترین",
  fastest: "سریع‌ترین",
};

/** Apply a user-chosen sort to the ranked candidates (stable and explicit). */
export function sortScored(scored: ScoredOffer[], key: SortKey): ScoredOffer[] {
  const copy = [...scored];
  if (key === "cheapest") {
    return copy.sort((a, b) => a.offer.price.toman - b.offer.price.toman || a.offer.durationMinutes - b.offer.durationMinutes);
  }
  if (key === "fastest") {
    return copy.sort(
      (a, b) => a.offer.durationMinutes - b.offer.durationMinutes || a.offer.price.toman - b.offer.price.toman,
    );
  }
  return copy.sort((a, b) => (b.feasible !== a.feasible ? (a.feasible ? -1 : 1) : b.score - a.score));
}

/** Hour/day-part of an offer in the origin timezone, for filters and UI labels. */
export function departureContext(offer: FlightOffer): { hour: number; dateIso: string } {
  const tz = getCity(offer.originCode)?.timezone ?? "Asia/Tehran";
  return { hour: hourInZone(offer.departAt, tz), dateIso: isoDateInZone(offer.departAt, tz) };
}

export function tripMatchesOfferDate(query: TripQuery, offer: FlightOffer): boolean {
  return departureContext(offer).dateIso === query.departDate;
}
