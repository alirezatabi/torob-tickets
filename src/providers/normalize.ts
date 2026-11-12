import type { BaggageInfo, FlightOffer, FlightSegment, OfferWarning } from "@/domain/flight";
import type { CabinClass } from "@/domain/trip";
import { isCurrency, needsConversion, toToman, type Currency } from "@/domain/money";
import { getAirline } from "@/lib/airlines";
import { getCity } from "@/lib/cities";
import { minutesBetween } from "@/lib/time";

/**
 * Shared normalization primitives.
 *
 * Adapters are responsible only for *reading their own wire format*; everything
 * that must be true of every offer (currency conversion, recomputed duration,
 * derived stop count, warning bookkeeping) lives here so the rules cannot drift
 * between providers.
 */

export interface AssembleInput {
  providerId: string;
  providerName: string;
  rawId: string | null;
  airlineCode: string;
  flightNumber: string | null;
  segments: FlightSegment[];
  price: { amount: number; currency: string };
  baggage: BaggageInfo;
  refundable: boolean | null;
  cabin: CabinClass;
  offerUrl: string;
  providerUpdatedAt: string;
  fetchedAt: string;
  dataSource: "demo" | "live";
  /**
   * Bookable seats, only when the source states them. `null`/absent means *unknown* —
   * never "some default", because an invented number would gate a real purchase.
   */
  seatsAvailable?: number | null;
  /** Extra warnings the adapter knows about but cannot derive (e.g. assumed tz). */
  extraWarnings?: OfferWarning[];
}

export class NormalizationError extends Error {
  constructor(
    readonly code: "invalid-price" | "invalid-time" | "unknown-city" | "missing-route",
    message: string,
  ) {
    super(message);
    this.name = "NormalizationError";
  }
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function isValidInstant(value: string): boolean {
  return ISO_INSTANT.test(value) && !Number.isNaN(new Date(value).getTime());
}

/**
 * The single place an offer is created. Throws `NormalizationError` for records
 * that cannot be represented honestly (instead of inventing data).
 */
export function assembleOffer(input: AssembleInput): FlightOffer {
  const first = input.segments[0];
  const last = input.segments[input.segments.length - 1];
  if (!first || !last) throw new NormalizationError("missing-route", "Offer has no segments");

  if (!getCity(first.originCode)) throw new NormalizationError("unknown-city", `Unknown origin ${first.originCode}`);
  if (!getCity(last.destinationCode)) {
    throw new NormalizationError("unknown-city", `Unknown destination ${last.destinationCode}`);
  }

  for (const segment of input.segments) {
    if (!isValidInstant(segment.departAt) || !isValidInstant(segment.arriveAt)) {
      throw new NormalizationError("invalid-time", `Invalid segment time ${segment.departAt} → ${segment.arriveAt}`);
    }
    if (minutesBetween(segment.departAt, segment.arriveAt) <= 0) {
      throw new NormalizationError("invalid-time", "Segment arrives before it departs");
    }
  }

  const durationMinutes = minutesBetween(first.departAt, last.arriveAt);
  if (durationMinutes <= 0) throw new NormalizationError("invalid-time", "Offer arrives before it departs");

  if (!Number.isFinite(input.price.amount) || input.price.amount <= 0) {
    throw new NormalizationError("invalid-price", `Invalid price ${input.price.amount}`);
  }
  if (!isCurrency(input.price.currency)) {
    throw new NormalizationError("invalid-price", `Unsupported currency ${input.price.currency}`);
  }

  const currency = input.price.currency as Currency;
  const toman = toToman({ amount: input.price.amount, currency });

  const warnings = new Set<OfferWarning>(input.extraWarnings ?? []);
  if (needsConversion({ amount: input.price.amount, currency })) warnings.add("price-converted");
  if (input.baggage.checked === "unknown") warnings.add("baggage-unknown");
  if (input.refundable === null) warnings.add("refund-unknown");
  if (!input.flightNumber) warnings.add("flight-number-missing");
  if (typeof input.seatsAvailable !== "number") warnings.add("availability-unverified");

  // Stops come from the timeline, never from a provider string.
  const stops = input.segments.length - 1;

  const rawId = input.rawId ?? `${input.providerId}-${first.flightNumber ?? "unknown"}-${first.departAt}`;

  return {
    id: `${input.providerId}:${rawId}`,
    groupKey: buildGroupKey(
      input.airlineCode,
      input.flightNumber,
      localDepartureDate(first.departAt, first.originCode),
      first.originCode,
      last.destinationCode,
    ),
    providerId: input.providerId,
    providerName: input.providerName,
    airlineCode: input.airlineCode,
    airlineName: getAirline(input.airlineCode)?.fa ?? input.airlineCode,
    flightNumber: input.flightNumber,
    originCode: first.originCode,
    destinationCode: last.destinationCode,
    departAt: first.departAt,
    arriveAt: last.arriveAt,
    durationMinutes,
    stops,
    segments: input.segments,
    price: {
      original: { amount: input.price.amount, currency },
      toman,
      converted: needsConversion({ amount: input.price.amount, currency }),
    },
    baggage: input.baggage,
    refundable: input.refundable,
    cabin: input.cabin,
    offerUrl: input.offerUrl,
    providerUpdatedAt: input.providerUpdatedAt,
    fetchedAt: input.fetchedAt,
    dataSource: input.dataSource,
    ...(typeof input.seatsAvailable === "number" || input.seatsAvailable === null
      ? { seatsAvailable: input.seatsAvailable }
      : {}),
    warnings: [...warnings].sort(),
  };
}

/**
 * Identity of a *physical flight*: airline + flight number + departure day + route.
 * Deliberately excludes price, provider and exact minute, so two providers selling
 * the same flight collapse, while different flights never do.
 */
export function buildGroupKey(
  airlineCode: string,
  flightNumber: string | null,
  localDepartureDay: string,
  originCode: string,
  destinationCode: string,
): string {
  if (flightNumber) {
    return `${airlineCode}|${normalizeFlightNumber(flightNumber)}|${localDepartureDay}|${originCode}>${destinationCode}`;
  }
  return `${airlineCode}|~|${localDepartureDay}|${originCode}>${destinationCode}`;
}

/** The civil date at the departure airport — the day the user actually flies. */
export function localDepartureDate(departAtIso: string, originCode: string): string {
  const timeZone = getCity(originCode)?.timezone ?? "Asia/Tehran";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(departAtIso));
}

export function normalizeFlightNumber(flightNumber: string): string {
  return flightNumber.toUpperCase().replace(/\s+/g, "").replace(/([A-Z0-9]+)-?(\d+)([A-Z]?)$/, "$1$2$3");
}

/** Parse a provider price string that may use Persian digits and separators. */
export function parseAmount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = value
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[٬,\s]/g, "")
    .replace(/٫/g, ".")
    .replace(/[^\d.]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Canonicalize a flight number. Providers send "PC 517", "pc517", "PC-517" and
 * sometimes "PC517" for the same flight; all must collapse to "PC-517" or the
 * dedupe key breaks.
 */
export function formatFlightNumber(code: string, number: string | null): string | null {
  if (!number) return null;
  const latin = number
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  if (!latin) return null;

  const carrier = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  let digits = latin;
  if (latin.startsWith(carrier)) {
    digits = latin.slice(carrier.length);
  } else {
    // No carrier prefix: keep only the numeric part ("107").
    digits = latin.replace(/^[A-Z]+/, "");
  }
  if (!digits || !/^\d+$/.test(digits)) return null;
  return `${carrier}-${digits}`;
}

/** Build baggage info from provider-specific shapes, keeping `unknown` honest. */
export function baggage(checkedKg: number | null | undefined, cabinKg: number | null | undefined): BaggageInfo {
  const kg = checkedKg ?? null;
  return {
    checked: kg === null ? "unknown" : kg > 0 ? "included" : "not-included",
    cabinKg: cabinKg ?? null,
    checkedKg: kg,
  };
}
