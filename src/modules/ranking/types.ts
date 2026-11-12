/**
 * Ranking at a glance.
 *
 * The scorer is deterministic: the same inputs produce the same order, forever. The
 * LLM never influences ranking — it may only *explain* the numbers this module
 * computes (that is what keeps the product honest and auditable).
 *
 * This file defines the seam between the demo dataset and live data. Both are
 * projected onto `RankInput` before scoring, so there is exactly one implementation
 * of the weights, the factors and the tie-breaks.
 */

export type PriceSource = "demo" | "live";

export interface RankInputSegment {
  airlineCode: string;
  flightNumber: string | null;
  originCode: string;
  destinationCode: string;
  departAt: string;
  arriveAt: string;
  aircraft: string | null;
}

/**
 * Everything the scorer is allowed to see. Notably missing: price-origin labels,
 * provider names and URLs — ranking must not depend on which source produced an offer.
 */
export interface RankInput {
  /** Opaque id, returned unchanged in the scored result. */
  id: string;
  groupKey: string;
  airlineCode: string;
  airlineName: string;
  flightNumber: string | null;
  originCode: string;
  destinationCode: string;
  departAt: string;
  arriveAt: string;
  durationMinutes: number;
  stops: number;
  segments: RankInputSegment[];
  /** Integer toman. Always present and comparable. */
  priceToman: number;
  /** Cabin, so a business fare is not "better" purely because of price. */
  cabin: string;
  baggage: { checked: "included" | "not-included" | "unknown"; checkedKg: number | null };
  refundable: boolean | null;
  /** Freshness of the price, when known. */
  freshness?: string;
  /** 0..1 completeness score; unknown-fact offers are down-weighted, not dropped. */
  completeness?: number;
  /** True when the offer's data came from a live provider. */
  priceSource: PriceSource;
  /** Carrier reputation inputs, kept explicit so a live carrier can supply them. */
  onTimeScore: number | null;
  /** Number of sellers offering the exact same flight (price competition signal). */
  sellerCount: number;
}

export interface ScoreFactorBreakdown {
  /** 0..1, 1 = best. */
  score: number;
  /** Contribution to the final 0..100 score before normalisation. */
  weighted: number;
  /** Persian, numeric, citation-ready sentence. */
  reasonFa: string;
}

export type RankDecision = "best" | "cheapest" | "fastest" | "comfortable" | "alternative";

export interface ScoredRankInput {
  input: RankInput;
  score: number;
  factors: Record<string, ScoreFactorBreakdown>;
  /** Primary badge (the most specific claim about this offer). */
  decision: RankDecision;
  /**
   * Every badge this offer earned. A single offer can legitimately be both the best
   * match and the cheapest — the UI shows both instead of hiding one.
   */
  badges: RankDecision[];
  /** Position among all scored offers, 1-based. */
  rank: number;
  /** False when the offer violates a stated hard requirement (it is still shown). */
  feasible: boolean;
  /** Persian reasons for the exclusion, empty when feasible. */
  violations: string[];
}
