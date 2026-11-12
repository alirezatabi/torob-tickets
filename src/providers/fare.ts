import { getCity } from "@/lib/cities";
import { patternsForRoute, type FlightPattern } from "@/lib/schedules";
import { localToUtcIso, seededUnit, wallClockInZone } from "@/lib/time";

/**
 * A deterministic "fare engine" that mimics how a marketplace provider prices a
 * scheduled flight: base fare, lead-time curve, weekend/yield bump, plus a stable
 * per-(provider, flight, date) jitter so the same query always returns the same
 * numbers (essential for a reproducible demo and for tests).
 *
 * Provider adapters own their markup rules and their own wire format; this module
 * only produces the numbers.
 */
export interface FareRules {
  /** Multiplier applied to the base tonman price. */
  markup: number;
  /** Additive per-ticket service fee in toman (0 for some providers). */
  serviceFeeToman: number;
  /** Amplitude of the deterministic jitter (0.04 = ±4%). */
  jitter: number;
  /** Whether this provider ever omits baggage data (tests the "unknown" path). */
  omitBaggageFor?: (pattern: FlightPattern, seed: number) => boolean;
}

export interface FareQuote {
  pattern: FlightPattern;
  dateIso: string;
  priceToman: number;
  markupApplied: number;
}

/** Lead-time curve: last-minute and far-future flights cost more. */
export function leadTimeMultiplier(daysAhead: number): number {
  if (daysAhead <= 1) return 1.34;
  if (daysAhead <= 3) return 1.2;
  if (daysAhead <= 7) return 1.1;
  if (daysAhead <= 21) return 1.0;
  if (daysAhead <= 45) return 0.96;
  return 1.02;
}

export function quoteFare(
  providerId: string,
  pattern: FlightPattern,
  dateIso: string,
  daysAhead: number,
  rules: FareRules,
): FareQuote {
  const jitterSeed = seededUnit(`${providerId}:${pattern.id}:${dateIso}`);
  const jitter = 1 + (jitterSeed - 0.5) * 2 * rules.jitter;
  // Thursday/Friday departures (the Iranian weekend) carry a small yield premium.
  const weekday = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
  const weekdayBump = weekday === 4 || weekday === 5 ? 1.06 : 1;
  const raw = pattern.basePriceToman * leadTimeMultiplier(daysAhead) * rules.markup * jitter * weekdayBump;
  // Round to the nearest 10 000 toman, like a real fare.
  const priceToman = Math.max(100_000, Math.round(raw / 10_000) * 10_000 + rules.serviceFeeToman);
  return { pattern, dateIso, priceToman, markupApplied: rules.markup };
}

/**
 * Departure/arrival days: overnight flights arrive the next day, and the demo
 * needs that to be visible rather than assumed.
 */
export function overnightDates(departIsoDate: string, departMinutes: number, durationMinutes: number): {
  departDateIso: string;
  arriveDateIso: string;
} {
  const total = departMinutes + durationMinutes;
  const extraDays = Math.floor(total / 1440);
  const arriveDateIso = extraDays === 0 ? departIsoDate : addDaysIso(departIsoDate, extraDays);
  return { departDateIso: departIsoDate, arriveDateIso };
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * What a provider actually publishes: wall-clock times at each airport.
 * A provider does not know the other airport's offset, so it prints local times and
 * normalization has to rebuild the UTC instants.
 */
export function localItinerary(flight: {
  segments: { airlineCode: string; flightNumber: string; originCode: string; destinationCode: string; departAt: string; arriveAt: string; aircraft: string }[];
}): { no: string; fromCode: string; toCode: string; departureLocal: string; arrivalLocal: string; aircraft: string }[] {
  return flight.segments.map((segment) => ({
    no: segment.flightNumber,
    fromCode: segment.originCode,
    toCode: segment.destinationCode,
    departureLocal: localWallClock(segment.departAt, segment.originCode),
    arrivalLocal: localWallClock(segment.arriveAt, segment.destinationCode),
    aircraft: segment.aircraft,
  }));
}

/** `YYYY-MM-DDTHH:MM` in the given airport's timezone (no offset, like provider feeds). */
export function localWallClock(iso: string, code: string): string {
  const { date, time } = wallClockInZone(iso, cityTimeZone(code));
  return `${date}T${time}`;
}

/** Parse a provider's local wall clock into a UTC instant at that airport. */
export function wallClockToInstant(localIso: string, code: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(localIso);
  if (!match) return new Date(localIso).toISOString();
  const [, y, m, d, h, min] = match;
  return localToUtcIso(`${y}-${m}-${d}`, Number(h) * 60 + Number(min), cityTimeZone(code));
}

export function cityTimeZone(code: string): string {
  return getCity(code)?.timezone ?? "Asia/Tehran";
}

/** Average price for a route, used by the UI to explain "below/above average". */
export function routeAverageToman(originCode: string, destinationCode: string, dateIso: string, daysAhead: number): number {
  const patterns = patternsForRoute(originCode, destinationCode, dateIso);
  if (patterns.length === 0) return 0;
  const prices = patterns.map((p) => p.basePriceToman * leadTimeMultiplier(daysAhead));
  return Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
}

