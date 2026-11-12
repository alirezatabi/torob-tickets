/**
 * Shared normalization for live offers.
 *
 * Every live connector ends here, so that these rules exist exactly once:
 *   • money is integer toman with an explicit unit conversion;
 *   • an absent fact stays absent (`null` / `"unknown"`), it is never inferred —
 *     except durations, which are arithmetic and are labelled as such;
 *   • identity (`offerKey` for history, `groupKey` for display) is derived, never random;
 *   • freshness is computed from the provider's own policy + the observation instant.
 */

import type { BaggageInfo, FlightOffer, FlightSegment, FreshnessState, OfferWarning } from "@/domain/flight";
import type { CabinClass } from "@/domain/trip";
import { getAirline } from "@/lib/airlines";
import { getCity } from "@/lib/cities";
import { minutesBetween } from "@/lib/time";
import { airportCity } from "@/modules/airports";
import {
  deterministicOfferId,
  displayGroupKey,
  offerKey,
  type FareFacts,
} from "@/modules/live/offer-identity";
import type { FreshnessPolicy } from "../contracts/provider";
import type { NormalizedPrice } from "@/modules/money/price";

export interface LiveOfferDraft {
  providerId: string;
  providerName: string;
  sourceKind: "html" | "api";
  endpoint: string;
  /** Provider's own record id when it exists; identity does not depend on it. */
  rawRecordId: string | null;
  sellerLabel: string | null;
  airlineCode: string;
  flightNumber: string | null;
  originAirport: string;
  destinationAirport: string;
  /** ISO instants. If the source gives only wall clocks, the connector converts them. */
  departAt: string;
  arriveAt: string;
  /** Explicitly `null` when the source omits duration (we may derive it and mark it). */
  durationMinutes: number | null;
  segments: FlightSegment[];
  /**
   * Stop count when the source states it but the intermediate airports are unknown
   * (aggregators often say "یک توقف" without naming the connection point). Never
   * synthesise fake segments to express this.
   */
  stopsOverride?: number | null;
  price: NormalizedPrice;
  baggage: BaggageInfo;
  refundable: boolean | null;
  cabin: CabinClass;
  fareClass: string | null;
  fareName: string | null;
  ticketType: "system" | "charter" | "unknown";
  marketingCarrier: string | null;
  offerUrl: string;
  /** When the source last updated this price (falls back to the fetch instant). */
  providerUpdatedAt: string;
  fetchedAt: string;
  /** Set only when the provider states bookable seats / availability. */
  seatsAvailable: number | null;
  mergedRows?: number;
  /** Which unit conversion happened, if any. */
  unitConverted: boolean;
  extraWarnings?: OfferWarning[];
}

export class LiveNormalizationError extends Error {
  constructor(
    readonly code: "invalid-price" | "invalid-time" | "unknown-city" | "missing-route" | "invalid-airport",
    message: string,
  ) {
    super(message);
    this.name = "LiveNormalizationError";
  }
}

/**
 * Freshness is a statement about the *price observation*, not about the source's
 * uptime: a price older than the provider's stale window is "possibly-stale", and
 * beyond that it is "unverified" — it is still shown, but never called available.
 */
export function computeFreshness(
  observedAtIso: string,
  now: Date,
  policy: FreshnessPolicy,
): FreshnessState {
  const ageMs = now.getTime() - new Date(observedAtIso).getTime();
  if (Number.isNaN(ageMs) || ageMs < 0) return "unverified";
  if (ageMs <= policy.freshMs) return "fresh";
  if (ageMs <= policy.staleMs) return "possibly-stale";
  return "unverified";
}

/** 0..1 share of optional facts the source actually provided. */
export function completenessOf(input: {
  flightNumber: string | null;
  baggage: BaggageInfo;
  refundable: boolean | null;
  durationMinutes: number | null;
  segments: FlightSegment[];
  fareClass: string | null;
  offerUrlIsRouteOnly: boolean;
}): number {
  let score = 0;
  let weight = 0;
  const add = (value: boolean, w: number) => {
    weight += w;
    if (value) score += w;
  };
  // Weights reflect what actually changes a buying decision.
  add(input.flightNumber !== null, 5);
  add(input.baggage.checked !== "unknown", 3);
  add(input.refundable !== null, 2);
  add(input.durationMinutes !== null, 1);
  add(input.segments.length > 1, 1);
  add(input.fareClass !== null, 2);
  add(!input.offerUrlIsRouteOnly, 1);
  return weight === 0 ? 0 : Math.round((score / weight) * 100) / 100;
}

/**
 * Validate + assemble. Throws `LiveNormalizationError` instead of papering over a
 * broken record — the connector records the rejection and continues.
 */
export function assembleLiveOffer(
  input: LiveOfferDraft,
  options: { freshness: FreshnessPolicy; now: Date },
): FlightOffer {
  if (!input.originAirport || !input.destinationAirport) {
    throw new LiveNormalizationError("missing-route", "missing origin/destination airport");
  }
  const originCity = airportCity(input.originAirport) ?? input.originAirport;
  const destinationCity = airportCity(input.destinationAirport) ?? input.destinationAirport;
  if (!getCity(originCity)) throw new LiveNormalizationError("unknown-city", `unknown origin ${input.originAirport}`);
  if (!getCity(destinationCity)) {
    throw new LiveNormalizationError("unknown-city", `unknown destination ${input.destinationAirport}`);
  }
  const foreign = input.price.declaredUnit === "foreign";
  // A foreign-currency offer legitimately has no toman value. Anything else with a
  // non-positive toman price is a broken record and must be rejected.
  if (foreign) {
    if (!Number.isSafeInteger(input.price.originalAmount) || input.price.originalAmount <= 0) {
      throw new LiveNormalizationError("invalid-price", `invalid foreign amount ${input.price.originalAmount}`);
    }
  } else if (!Number.isSafeInteger(input.price.toman) || input.price.toman <= 0) {
    throw new LiveNormalizationError("invalid-price", `invalid price ${input.price.toman}`);
  }
  if (Number.isNaN(new Date(input.departAt).getTime()) || Number.isNaN(new Date(input.arriveAt).getTime())) {
    throw new LiveNormalizationError("invalid-time", "invalid depart/arrive instant");
  }

  const derivedDuration =
    input.durationMinutes ?? Math.max(0, Math.round(minutesBetween(input.departAt, input.arriveAt)));
  if (derivedDuration <= 0) throw new LiveNormalizationError("invalid-time", "arrival before departure");

  const warnings = new Set<OfferWarning>(input.extraWarnings ?? []);
  if (input.unitConverted || input.price.converted) warnings.add("price-converted");
  if (input.baggage.checked === "unknown") warnings.add("baggage-unknown");
  if (input.refundable === null) warnings.add("refund-unknown");
  if (!input.flightNumber) warnings.add("flight-number-missing");
  if (input.durationMinutes === null) warnings.add("duration-inferred");
  if (input.stopsOverride !== undefined && input.stopsOverride !== null && input.segments.length !== input.stopsOverride + 1) {
    warnings.add("stops-partial");
  }
  if (input.seatsAvailable === null) warnings.add("availability-unverified");
  if (input.sellerLabel) warnings.add("seller-aggregated");
  if (foreign) warnings.add("price-foreign");

  const departDate = localDate(input.departAt, originCity);
  const baggageTokens = baggageFacts(input.baggage);

  const facts: FareFacts = {
    airlineCode: input.airlineCode,
    flightNumber: input.flightNumber,
    originAirport: input.originAirport,
    destinationAirport: input.destinationAirport,
    departDate,
    cabin: input.cabin,
    fareClass: input.fareClass,
    baggage: baggageTokens,
    refund: input.refundable === null ? "unknown" : input.refundable ? "refundable" : "non-refundable",
    ticketType: input.ticketType,
    marketingCarrier: input.marketingCarrier,
  };

  const priceObservedAt = input.providerUpdatedAt || input.fetchedAt;
  const freshness = computeFreshness(priceObservedAt, options.now, options.freshness);

  const key = offerKey(facts);

  return {
    id: deterministicOfferId(input.providerId, key),
    groupKey: displayGroupKey({
      airlineCode: input.airlineCode,
      flightNumber: input.flightNumber,
      originAirport: input.originAirport,
      destinationAirport: input.destinationAirport,
      departDate,
    }),
    providerId: input.providerId,
    providerName: input.providerName,
    airlineCode: input.airlineCode,
    airlineName: getAirline(input.airlineCode)?.fa ?? input.airlineCode,
    flightNumber: input.flightNumber,
    originAirport: input.originAirport,
    destinationAirport: input.destinationAirport,
    originCode: originCity,
    destinationCode: destinationCity,
    departAt: input.departAt,
    arriveAt: input.arriveAt,
    durationMinutes: derivedDuration,
    stops: input.stopsOverride ?? Math.max(0, input.segments.length - 1),
    segments: input.segments,
    price: {
      original: {
        amount: input.price.originalAmount,
        currency: input.price.currency as FlightOffer["price"]["original"]["currency"],
      },
      toman: foreign ? 0 : input.price.toman,
      converted: input.price.converted || input.unitConverted,
      comparable: !foreign,
    },
    baggage: input.baggage,
    refundable: input.refundable,
    cabin: input.cabin,
    offerUrl: input.offerUrl,
    providerUpdatedAt: priceObservedAt,
    fetchedAt: input.fetchedAt,
    dataSource: "live",
    warnings: [...warnings].sort(),
    // ——— live-only facts ———
    fare: {
      cabin: input.cabin,
      fareClass: input.fareClass,
      ticketType: input.ticketType,
      fareName: input.fareName,
    },
    freshness,
    seatsAvailable: input.seatsAvailable,
    priceObservedAt,
    lastVerifiedAt: null,
    completeness: completenessOf({
      flightNumber: input.flightNumber,
      baggage: input.baggage,
      refundable: input.refundable,
      durationMinutes: input.durationMinutes,
      segments: input.segments,
      fareClass: input.fareClass,
      offerUrlIsRouteOnly: input.offerUrl.includes("?") && !input.rawRecordId,
    }),
    provenance: {
      sourceKind: input.sourceKind,
      endpoint: input.endpoint,
      rawRecordId: input.rawRecordId,
      sellerLabel: input.sellerLabel,
      unitConverted: input.price.converted || input.unitConverted,
      mergedRows: input.mergedRows ?? 1,
    },
  };
}

/** Baggage → stable tokens so two rows can be compared without reading prose. */
export function baggageFacts(baggage: BaggageInfo): string[] {
  const tokens: string[] = [];
  if (baggage.checked === "unknown") tokens.push("checked-unknown");
  else if (baggage.checked === "not-included") tokens.push("checked-none");
  else tokens.push(baggage.checkedKg === null ? "checked-unknown-kg" : `checked-${baggage.checkedKg}kg`);
  if (baggage.cabinKg !== null) tokens.push(`cabin-${baggage.cabinKg}kg`);
  return tokens;
}

/** Civil date at the origin city's timezone. */
export function localDate(iso: string, cityCode: string): string {
  const timeZone = getCity(cityCode)?.timezone ?? "Asia/Tehran";
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
}

