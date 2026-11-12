/**
 * Offer identity — the single most safety-critical piece of the live pipeline.
 *
 * Two offers are the *same product* only if all of these match:
 *   route (airports) · departure day · airline · flight number · cabin ·
 *   fare class · baggage · ticket type
 *
 * Anything weaker would let a price-history chart draw one line through two
 * different products (e.g. a 23 kg fare and a hand-baggage-only fare), which is the
 * most misleading thing a price comparison can do. When a fact is unknown it is
 * written as `?` — never as a wildcard that merges.
 *
 * Two identities exist and must not be confused:
 *   • `offerKey`  — price-history identity. Includes baggage/refund/ticket type.
 *   • `groupKey`  — display identity (same physical flight), which is allowed to
 *                   aggregate different fare conditions as separate rows.
 */

import type { CabinClass } from "@/domain/trip";

/** The facts that decide whether two prices are comparable. */
export interface FareFacts {
  airlineCode: string;
  flightNumber: string | null;
  originAirport: string | null;
  destinationAirport: string | null;
  /** Civil departure date at the origin: YYYY-MM-DD. */
  departDate: string;
  cabin: CabinClass | string;
  fareClass: string | null;
  /** Normalized baggage tokens, e.g. ["checked-30kg"] or ["carry-on-only"]. */
  baggage: string[];
  /** Normalized refund token, e.g. "refundable" | "non-refundable" | "unknown". */
  refund: string;
  ticketType: "system" | "charter" | "unknown";
  /** Marketing carrier when different from the operating one (codeshare). */
  marketingCarrier: string | null;
}

const UNKNOWN = "?";

/**
 * Canonical, stable, human-readable but not intended to be pretty.
 * Example: `IR|452|IKA>IST|2026-11-20|economy|Y|bag:checked-30kg|ref:non-refundable|tt:system`
 */
export function offerKey(facts: FareFacts): string {
  const parts = [
    `air:${segmentOrUnknown(facts.airlineCode)}`,
    `flt:${segmentOrUnknown(facts.flightNumber, { strip: true })}`,
    `rt:${facts.originAirport ?? UNKNOWN}>${facts.destinationAirport ?? UNKNOWN}`,
    `day:${facts.departDate}`,
    `cab:${String(facts.cabin).toLowerCase()}`,
    `fc:${segmentOrUnknown(facts.fareClass)}`,
    `bag:${facts.baggage.length ? [...facts.baggage].sort().join("+") : UNKNOWN}`,
    `ref:${facts.refund || "unknown"}`,
    `tt:${facts.ticketType}`,
    `mk:${segmentOrUnknown(facts.marketingCarrier)}`,
  ];
  return parts.join("|");
}

/**
 * Display identity: same physical flight, ignoring fare conditions.
 * Number-less offers get a `~` and therefore never merge with a numbered offer.
 */
export function displayGroupKey(facts: {
  airlineCode: string;
  flightNumber: string | null;
  originAirport: string | null;
  destinationAirport: string | null;
  departDate: string;
}): string {
  const number = facts.flightNumber ? facts.flightNumber.replace(/[^A-Z0-9]/gi, "").toUpperCase() : "~";
  return [
    facts.airlineCode.toUpperCase(),
    number,
    facts.departDate,
    `${facts.originAirport ?? facts.destinationAirport ?? UNKNOWN}`,
    `${facts.destinationAirport ?? UNKNOWN}`,
  ].join("|");
}

/**
 * Route key used to partition price history queries: it is deliberately city-level
 * so "Tehran → Istanbul" history can be read even when one observation came from IKA
 * and another from THR — but each observation still carries its airport, so the
 * chart can filter. (Airport codes are part of `offerKey`, so history lines never mix.)
 */
export function routeKey(originAirport: string, destinationAirport: string): string {
  return `${originAirport}>${destinationAirport}`;
}

function segmentOrUnknown(value: string | null, opts: { strip?: boolean } = {}): string {
  if (!value) return UNKNOWN;
  const cleaned = opts.strip ? value.replace(/[^A-Z0-9]/gi, "").toUpperCase() : value.trim().toUpperCase();
  return cleaned.length > 0 ? cleaned : UNKNOWN;
}

/**
 * Database id for an offer row.
 *
 * Providers are not required to give an id, and the same flight can be scraped
 * repeatedly, so identity must be *derived*, never random:
 *   `${providerId}:${offerKey}`
 * Two different searches that see the same product produce the same id → the upsert
 * updates one row instead of duplicating it (correction #5).
 */
export function deterministicOfferId(providerId: string, key: string): string {
  return `${providerId}:${key}`;
}

/** Stable without crypto: FNV-1a 32-bit, hex. Used for history keys in URLs. */
export function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
