/**
 * The hybrid scorer and the final decision.
 *
 * Two layers, deliberately:
 *
 *   1. `rankInputs` — the *only* scorer. It works on `RankInput`, so demo data and
 *      live rows are compared by identical arithmetic. Score = weighted sum of
 *      bounded sub-scores, 0–100, higher is better, fully deterministic.
 *
 *   2. `decide` — turns a ranking into the four badges the UI shows. "best" is the
 *      top-ranked feasible offer; "cheapest"/"fastest" are the cheapest/fastest among
 *      feasible ones; if they are all the same offer the badges collapse honestly
 *      instead of being duplicated.
 *
 * Hard constraints stay hard: an offer that violates an explicit requirement is
 * excluded from the badge pool but never dropped from the list.
 */

import { DAY_PART_RANGES, type QueryPreferences } from "@/domain/trip";
import { hourInZone } from "@/lib/format";
import { getCity } from "@/lib/cities";
import type { RankDecision, RankInput, ScoredRankInput, ScoreFactor, ScoreFactorBreakdown, PriceSource } from "./types";

export const FACTOR_LABELS_FA: Record<string, string> = {
  price: "قیمت",
  duration: "مدت سفر",
  stops: "تعداد توقف",
  baggage: "بار همراه",
  refund: "شرایط استرداد",
  timeOfDay: "ساعت پرواز",
  airline: "ایرلاین درخواستی",
  completeness: "کامل بودن اطلاعات",
  freshness: "تازگی قیمت",
  sellers: "رقابت فروشندگان",
};

/** Extra signals live data has that demo data does not. They are additive and small. */
export interface LiveFactorOptions {
  /** How much "this price was observed recently" matters (0 disables it). */
  freshnessWeight: number;
  /** How much "more sellers = more real competition" matters. */
  sellersWeight: number;
  /** How much "the source told us more facts" matters. */
  completenessWeight: number;
}

export const DEFAULT_LIVE_FACTORS: LiveFactorOptions = {
  freshnessWeight: 0.04,
  sellersWeight: 0.03,
  completenessWeight: 0.03,
};

function inverseRatio(value: number, best: number, exponent = 1): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (best <= 0) return 1;
  return Math.max(0, Math.min(1, Math.pow(best / value, exponent)));
}

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

function baggageScore(baggage: RankInput["baggage"]): number {
  if (baggage.checked === "included") {
    const kg = Math.min(baggage.checkedKg ?? 20, 30);
    return 0.75 + (kg / 30) * 0.25;
  }
  if (baggage.checked === "unknown") return 0.45;
  return 0.1;
}

function refundScore(refundable: boolean | null): number {
  if (refundable === true) return 1;
  if (refundable === null) return 0.35;
  return 0.1;
}

export function localDepartureHour(input: Pick<RankInput, "departAt" | "originCode">): number {
  return hourInZone(input.departAt, getCity(input.originCode)?.timezone ?? "Asia/Tehran");
}

function timeOfDayScore(input: RankInput, prefs: QueryPreferences): number {
  if (!prefs.dayPart) return 0.6;
  const [start, end] = DAY_PART_RANGES[prefs.dayPart];
  const hour = localDepartureHour(input);
  if (hour >= start && hour < end) return 1;
  const distance = Math.min(Math.abs(hour - start), Math.abs(hour - end));
  if (distance <= 2) return 0.6;
  if (distance <= 4) return 0.35;
  return 0.15;
}

function airlineScore(input: RankInput, prefs: QueryPreferences): number {
  if (prefs.preferredAirlines.length === 0) return 0.6;
  return prefs.preferredAirlines.includes(input.airlineCode) ? 1 : 0.25;
}

function freshnessScore(freshness: string | undefined): number {
  switch (freshness) {
    case "fresh":
      return 1;
    case "possibly-stale":
      return 0.7;
    case "unverified":
      return 0.4;
    case "unavailable":
      return 0;
    case "demo":
    case undefined:
      return 0.8; // demo prices are internally consistent; do not let them win on freshness
    default:
      return 0.6;
  }
}

/**
 * Explicit requirements, as Persian reasons. These exclude an offer from the badge
 * pool but keep it visible.
 */
export function hardConstraintViolations(input: RankInput, prefs: QueryPreferences): string[] {
  const violations: string[] = [];
  if (prefs.maxStops !== null && input.stops > prefs.maxStops) {
    violations.push(`${input.stops} توقف دارد؛ حداکثر مجاز ${prefs.maxStops}`);
  }
  if (prefs.baggageRequired && input.baggage.checked !== "included") {
    violations.push(input.baggage.checked === "unknown" ? "وضعیت بار نامشخص است" : "بار همراه در نرخ نیست");
  }
  if (prefs.refundableOnly && input.refundable !== true) {
    violations.push(input.refundable === null ? "شرایط استرداد نامشخص است" : "بلیت قابل استرداد نیست");
  }
  if (prefs.maxPriceToman !== null && input.priceToman > prefs.maxPriceToman) {
    violations.push("گران‌تر از بودجهٔ اعلام‌شده");
  }
  if (prefs.dayPart) {
    const [start, end] = DAY_PART_RANGES[prefs.dayPart];
    const hour = localDepartureHour(input);
    if (hour < start || hour >= end) violations.push("ساعت پرواز خارج از بازهٔ درخواستی است");
  }
  return violations;
}

/**
 * Weight vectors per price preference (B14: these used to live in `ranking/score.ts`, which
 * imported this module — a cycle that only worked because both sides were function-level).
 * Owning them here makes the dependency one-way: `score.ts` → `core.ts`.
 */
export const BASE_WEIGHTS: Record<QueryPreferences["pricePreference"], Record<ScoreFactor, number>> = {
  low: { price: 0.52, duration: 0.15, stops: 0.12, baggage: 0.07, refund: 0.04, timeOfDay: 0.06, airline: 0.04 },
  balanced: { price: 0.4, duration: 0.2, stops: 0.13, baggage: 0.11, refund: 0.06, timeOfDay: 0.06, airline: 0.04 },
  comfort: { price: 0.12, duration: 0.22, stops: 0.16, baggage: 0.18, refund: 0.09, timeOfDay: 0.07, airline: 0.04 },
};

/** Derive normalized weights (sum = 1) from the structured intent. */
export function deriveWeights(prefs: QueryPreferences): Record<ScoreFactor, number> {
  const weights: Record<ScoreFactor, number> = { ...BASE_WEIGHTS[prefs.pricePreference] };
  if (prefs.maxStops !== null) weights.stops += 0.06;
  if (prefs.baggageRequired) weights.baggage += 0.05;
  if (prefs.refundableOnly) weights.refund += 0.05;
  if (prefs.dayPart) weights.timeOfDay += 0.05;
  if (prefs.preferredAirlines.length > 0) weights.airline += 0.04;
  if (prefs.pricePreference === "low" && prefs.maxPriceToman !== null) weights.price += 0.04;

  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  for (const key of Object.keys(weights) as ScoreFactor[]) weights[key] = weights[key] / total;
  return weights;
}

export type RankWeights = Record<ScoreFactor, number> & Partial<Record<"completeness" | "freshness" | "sellers", number>>;

export interface RankCoreResult {
  ranked: ScoredRankInput[];
  /** Offers that satisfy every hard constraint, best first. */
  feasible: ScoredRankInput[];
  excluded: ScoredRankInput[];
  weights: RankWeights;
}

/**
 * Score and sort. Sub-scores are relative to the best value *within this candidate
 * set*, which is what makes the result meaningful per search and keeps the ranking
 * stable when a single outlier (a business fare) appears.
 */
export function rankInputs(
  inputs: RankInput[],
  prefs: QueryPreferences,
  options: { liveFactors?: Partial<LiveFactorOptions> } = {},
): RankCoreResult {
  const base = deriveWeights(prefs);
  const live: LiveFactorOptions = { ...DEFAULT_LIVE_FACTORS, ...options.liveFactors };
  const hasLive = inputs.some((input) => input.priceSource === "live");

  // Live-only factors take a small, fixed slice; the demo weights are rescaled so the
  // total stays 1 and demo rankings are byte-identical to before.
  const liveSlice = hasLive
    ? live.freshnessWeight + live.sellersWeight + live.completenessWeight
    : 0;
  const scale = 1 - liveSlice;
  const weights: RankWeights = {
    ...(Object.fromEntries(
      Object.entries(base).map(([key, value]) => [key, value * scale]),
    ) as Record<ScoreFactor, number>),
    ...(hasLive
      ? {
          freshness: live.freshnessWeight,
          sellers: live.sellersWeight,
          completeness: live.completenessWeight,
        }
      : {}),
  };

  if (inputs.length === 0) {
    return { ranked: [], feasible: [], excluded: [], weights };
  }

  const minPrice = Math.min(...inputs.map((input) => input.priceToman));
  const minDuration = Math.min(...inputs.map((input) => input.durationMinutes));
  const maxSellers = Math.max(1, ...inputs.map((input) => input.sellerCount));

  const scored: ScoredRankInput[] = inputs.map((input) => {
    const parts: Record<string, number> = {
      price: inverseRatio(input.priceToman, minPrice, priceCurve(prefs.pricePreference)) * (weights.price ?? 0),
      duration: inverseRatio(input.durationMinutes, minDuration, 1.15) * (weights.duration ?? 0),
      stops: stopsScore(input.stops) * (weights.stops ?? 0),
      baggage: baggageScore(input.baggage) * (weights.baggage ?? 0),
      refund: refundScore(input.refundable) * (weights.refund ?? 0),
      timeOfDay: timeOfDayScore(input, prefs) * (weights.timeOfDay ?? 0),
      airline: airlineScore(input, prefs) * (weights.airline ?? 0),
    };
    if (hasLive) {
      parts.freshness = freshnessScore(input.freshness) * (weights.freshness ?? 0);
      parts.sellers = inverseRatio(maxSellers, Math.max(1, input.sellerCount), 0.5) * (weights.sellers ?? 0);
      parts.completeness = (input.completeness ?? 0.5) * (weights.completeness ?? 0);
    }

    const breakdown: Record<string, ScoreFactorBreakdown> = {};
    for (const [key, weighted] of Object.entries(parts)) {
      const weight = (weights as Record<string, number | undefined>)[key] ?? 0;
      breakdown[key] = {
        score: weight > 0 ? weighted / weight : 0,
        weighted,
        reasonFa: "",
      };
    }

    const total = Object.values(parts).reduce((a, b) => a + b, 0) * 100;
    const violations = hardConstraintViolations(input, prefs);
    return {
      input,
      score: Math.round(total * 10) / 10,
      factors: breakdown,
      decision: "alternative" as RankDecision,
      badges: [] as RankDecision[],
      rank: 0,
      violations,
      feasible: violations.length === 0,
    };
  });

  const byScore = scored.sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    if (Math.abs(b.score - a.score) > 0.05) return b.score - a.score;
    if (a.input.priceToman !== b.input.priceToman) return a.input.priceToman - b.input.priceToman;
    if (a.input.durationMinutes !== b.input.durationMinutes) return a.input.durationMinutes - b.input.durationMinutes;
    // Final tie-break on id keeps the order stable across runs and machines.
    return a.input.id.localeCompare(b.input.id);
  });

  byScore.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  return {
    ranked: byScore,
    feasible: byScore.filter((entry) => entry.feasible),
    excluded: byScore.filter((entry) => !entry.feasible),
    weights,
  };
}

/**
 * Assign the four badges. Rules, in order:
 *   • best      = first feasible ranked offer (or the best overall if nothing is feasible)
 *   • cheapest  = cheapest feasible, ignoring an existing "best" badge
 *   • fastest   = fastest feasible, ignoring an existing badge
 *   • everything else = "alternative"
 * A badge is never duplicated onto one offer.
 */
export function decide(result: RankCoreResult): ScoredRankInput[] {
  const pool = result.feasible.length > 0 ? result.feasible : result.ranked;
  if (pool.length === 0) return result.ranked;

  // Reset so `decide` stays idempotent when called twice on the same result.
  for (const entry of result.ranked) {
    entry.badges = [];
    entry.decision = "alternative";
  }

  const award = (entry: ScoredRankInput | undefined, decision: RankDecision) => {
    if (!entry || entry.badges.includes(decision)) return;
    entry.badges.push(decision);
  };

  award(pool[0], "best");

  award(
    [...pool].sort((a, b) => a.input.priceToman - b.input.priceToman || a.input.durationMinutes - b.input.durationMinutes)[0],
    "cheapest",
  );

  award(
    [...pool].sort((a, b) => a.input.durationMinutes - b.input.durationMinutes || a.input.priceToman - b.input.priceToman)[0],
    "fastest",
  );

  // A single primary badge, ordered by how specific the claim is.
  const priority: RankDecision[] = ["best", "cheapest", "fastest"];
  for (const entry of result.ranked) {
    entry.decision = priority.find((decision) => entry.badges.includes(decision)) ?? "alternative";
  }

  return result.ranked;
}

/** Convenience: score, sort and badge in one call. */
export function rankAndDecide(
  inputs: RankInput[],
  prefs: QueryPreferences,
  options: { liveFactors?: Partial<LiveFactorOptions> } = {},
): RankCoreResult {
  const result = rankInputs(inputs, prefs, options);
  decide(result);
  return result;
}

export type { PriceSource };
