/**
 * Offer identity — the safety-critical piece of the pipeline.
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

/** A single segment's contribution: unknown stays unknown, formatting never matters. */
function segmentOrUnknown(value: string | null | undefined, options: { strip?: boolean } = {}): string {
  if (!value) return UNKNOWN;
  const text = options.strip ? String(value).replace(/[^a-z0-9]/gi, "").toUpperCase() : String(value).trim();
  return text.length > 0 ? text : UNKNOWN;
}

/**
 * Display identity: is this the same *physical flight*?
 *
 * Coarser than `offerKey` on purpose (fare conditions differ per row), but never coarse
 * enough to merge two different flights: the number-less variant carries `~` so it can
 * never collide with a numbered flight.
 */
export function displayGroupKey(facts: {
  airlineCode: string;
  flightNumber: string | null;
  originAirport: string | null;
  destinationAirport: string | null;
  departDate: string;
}): string {
  const number = facts.flightNumber ? facts.flightNumber.replace(/[^a-z0-9]/gi, "").toUpperCase() : "~";
  return `${facts.airlineCode}|${number}|${facts.departDate}|${facts.originAirport ?? UNKNOWN}>${facts.destinationAirport ?? UNKNOWN}`;
}

/** `THR>MHD`, used as a stable key for route-level aggregates. */
export function routeKey(originAirport: string, destinationAirport: string): string {
  return `${originAirport}>${destinationAirport}`;
}

/**
 * Deterministic id for an offer.
 *
 * The id must be stable across runs and machines (the price-history chart keys on it), so
 * it is derived from the provider plus the fare-level identity — never from a raw row
 * index or a timestamp.
 */
export function deterministicOfferId(providerId: string, key: string): string {
  return `${providerId}:${shortHash(key)}`;
}

/** 32-bit FNV-1a, hex. Short because it only needs to distinguish offers of one provider. */
export function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
