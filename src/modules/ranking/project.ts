/**
 * Projections onto `RankInput`.
 *
 * Two adapters, one scorer: demo offers (in-memory) and live rows (from Postgres or
 * from the orchestrator's in-flight result). Keeping the projections here means the
 * ranking code never learns where data came from — a live offer cannot be boosted by
 * being live, except through the three explicit live factors.
 */

import type { FlightOffer, OfferGroup } from "@/domain/flight";
import type { RankInput } from "@/modules/ranking/types";
import { getLiveAirline, isKnownAirlineCode } from "@/modules/airlines/registry";
import { getAirline } from "@/lib/airlines";

/** Demo offer → RankInput. `sellerCount` is 1: a demo offer has exactly one seller. */
export function fromDemoOffer(offer: FlightOffer, options: { sellerCount?: number } = {}): RankInput {
  return {
    id: offer.id,
    groupKey: offer.groupKey,
    airlineCode: offer.airlineCode,
    airlineName: offer.airlineName,
    flightNumber: offer.flightNumber,
    originCode: offer.originCode,
    destinationCode: offer.destinationCode,
    departAt: offer.departAt,
    arriveAt: offer.arriveAt,
    durationMinutes: offer.durationMinutes,
    stops: offer.stops,
    segments: offer.segments.map((segment) => ({
      airlineCode: segment.airlineCode,
      flightNumber: segment.flightNumber,
      originCode: segment.originCode,
      destinationCode: segment.destinationCode,
      departAt: segment.departAt,
      arriveAt: segment.arriveAt,
      aircraft: segment.aircraft,
    })),
    priceToman: offer.price.toman,
    cabin: offer.cabin,
    baggage: { checked: offer.baggage.checked, checkedKg: offer.baggage.checkedKg },
    refundable: offer.refundable,
    freshness: offer.freshness ?? "demo",
    completeness: offer.completeness ?? 1,
    priceSource: "demo",
    onTimeScore: null,
    sellerCount: options.sellerCount ?? 1,
  };
}

/**
 * A whole **flight** → one row in the ranking.
 *
 * This is the projection the product actually ranks: the flight a user would board, priced
 * at its cheapest purchasable seller, with the real number of sellers as a competition
 * signal. `sellerCount` here is no longer "1 per offer" — that was the bug that made the
 * competition factor meaningless.
 */
export function fromGroup(
  group: OfferGroup,
  cheapest: FlightOffer,
  options: { sellerCount?: number; sellerFloor?: number } = {},
): RankInput {
  const sellers = Math.max(
    options.sellerCount ?? group.providers.length,
    options.sellerFloor ?? group.knownSellers,
    group.providers.length,
  );
  const base: RankInput = {
    ...fromDemoOffer(cheapest),
    groupKey: group.groupKey,
    // The *flight's* identity and price, not the cheapest seller's raw row.
    priceToman: cheapest.price.toman,
    sellerCount: sellers,
  };
  return base;
}

/**
 * The shape a live row has once it is a `FlightOffer` (offers coming back from the
 * orchestrator) — the same projection applies, with live facts filled in.
 */
export function fromLiveOffer(offer: FlightOffer, options: { sellerCount?: number } = {}): RankInput {
  const base = fromDemoOffer(offer, options);
  return {
    ...base,
    priceSource: "live",
    freshness: offer.freshness ?? "unverified",
    completeness: offer.completeness ?? 0.4,
    onTimeScore: null,
  };
}

/** Carrier label that works for demo and live carriers alike. */
export function airlineDisplayName(code: string, fallback?: string | null): string {
  const demo = getAirline(code);
  if (demo) return demo.fa;
  if (isKnownAirlineCode(code)) return getLiveAirline(code)?.fa ?? fallback ?? code;
  return fallback ?? code;
}
