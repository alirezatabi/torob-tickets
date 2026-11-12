/**
 * Mapping the source's own JSON to our raw offer shape.
 *
 * This is deliberately **key-pattern based**, not key-name based: we do not know (and cannot
 * keep up with) the exact field names of a third party's internal API. What we *require* is
 * that a field is unambiguous:
 *
 *   • a price field must look like a price (number or numeric string, next to a
 *     price-ish key) — we never guess a unit, and `unit` is passed in explicitly;
 *   • a time field must contain a real `hh:mm` (or a parsable ISO instant);
 *   • airline/flight-number must match their shapes.
 *
 * Anything that does not fit stays `null`, which downstream becomes a visible "unknown" —
 * never a fabricated number.
 */

import { normalizeDigits, parsePriceText } from "@/modules/money/price";

export interface MappedOffer {
  priceAmount: number | null;
  priceText: string | null;
  departAt: string | null;
  arriveAt: string | null;
  durationMinutes: number | null;
  stops: number | null;
  airlineCode: string | null;
  airlineName: string | null;
  flightNumber: string | null;
  cabin: string | null;
  originAirport: string | null;
  destinationAirport: string | null;
  seatsAvailable: number | null;
  /** Keys that were recognised, for the discovery report. */
  usedKeys: string[];
}

const PRICE_KEYS = /(^|_|\b)(price|fare|amount|total|cost|rate)(\b|_|$)/i;
const DEPART_KEYS = /(depart|takeoff|take_off|outbound.*time|time.*depart|origin.*time)/i;
const ARRIVE_KEYS = /(arriv|landing|land_time|destination.*time|time.*arriv)/i;
const DURATION_KEYS = /(duration|elapsed|flight_time|flighttime|total_time|totaltime)/i;
const STOPS_KEYS = /(stop|segment_count|segments_count|stop_count|stopcount)/i;
const AIRLINE_CODE_KEYS = /(airline.*(code|iata)|carrier.*(code|iata)|marketing.*code|^iata$)/i;
const AIRLINE_NAME_KEYS = /(airline.*name|carrier.*name|airline_name)/i;
const FLIGHT_KEYS = /(flight.*(number|no|code)|flightnumber|^flightno$|^flight_number$)/i;
const CABIN_KEYS = /(cabin|class|fare_class|fareclass)/i;
// Bare `origin`/`destination` are the most common names in the wild; the value still has to
// be a real three-letter IATA code to be used, so a bare key costs us no precision.
const ORIGIN_KEYS =
  /(?:^|\.)origin(?:Code|_code|Airport|_airport)?$|origin.*(?:iata|code|airport)|from.*(?:iata|code|airport)|(?:^|\.)from$/i;
const DEST_KEYS =
  /(?:^|\.)destination(?:Code|_code|Airport|_airport)?$|destination.*(?:iata|code|airport)|to.*(?:iata|code|airport)|(?:^|\.)to$/i;
const SEATS_KEYS = /(seat|remain|available.*count|capacity)/i;

function flatEntries(value: unknown, prefix = "", depth = 0): Array<[string, unknown]> {
  if (depth > 3 || !value || typeof value !== "object") return [];
  const out: Array<[string, unknown]> = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.push([path, child]);
    if (child && typeof child === "object" && !Array.isArray(child)) {
      out.push(...flatEntries(child, path, depth + 1));
    } else if (Array.isArray(child) && child[0] && typeof child[0] === "object") {
      // Legs/segments: the first element carries the origin, the last the destination.
      out.push(...flatEntries(child[0], `${path}[0]`, depth + 1));
    }
  }
  return out;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = normalizeDigits(value).replace(/[,\s٫]/g, "");
    if (/^\d+(\.\d+)?$/.test(cleaned)) return Number(cleaned);
  }
  return null;
}

function toClockOrIso(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = normalizeDigits(value).trim();
    const clock = /\b((?:[01]?\d|2[0-3]):[0-5]\d)\b/.exec(normalized);
    if (clock?.[1]) return clock[1];
    // ISO-ish instants are accepted as-is; the adapter decides the timezone.
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(normalized)) return normalized;
  }
  return null;
}

export function mapApiOffer(
  item: Record<string, unknown>,
  options: { unit: "toman" | "rial" },
): MappedOffer {
  const entries = flatEntries(item);
  const used: string[] = [];

  const pick = (pattern: RegExp, limit = 1): unknown[] => {
    const found: unknown[] = [];
    for (const [key, value] of entries) {
      if (!pattern.test(key.split(".").pop() ?? key) && !pattern.test(key)) continue;
      if (value === null || value === undefined || value === "") continue;
      found.push(value);
      if (found.length >= limit) break;
    }
    return found;
  };

  // Price: prefer a node next to a price key that also parses as money.
  let priceAmount: number | null = null;
  let priceText: string | null = null;
  for (const [key, value] of entries) {
    const leaf = key.split(".").pop() ?? key;
    if (!PRICE_KEYS.test(leaf) && !PRICE_KEYS.test(key)) continue;
    if (typeof value === "string") {
      const parsed = parsePriceText(value);
      if (parsed) {
        priceAmount = parsed.amount;
        priceText = value;
        used.push(key);
        break;
      }
    }
    const numeric = toNumber(value);
    if (numeric !== null && numeric > 1000) {
      priceAmount = numeric;
      // The source quotes numbers; keep the unit explicit rather than formatting a string.
      priceText = `${numeric} ${options.unit === "rial" ? "ریال" : "تومان"}`;
      used.push(key);
      break;
    }
  }

  const depart = pick(DEPART_KEYS, 1)[0];
  const arrive = pick(ARRIVE_KEYS, 1)[0];
  const duration = toNumber(pick(DURATION_KEYS, 1)[0]);
  const stops = toNumber(pick(STOPS_KEYS, 1)[0]);
  const airlineCode = pick(AIRLINE_CODE_KEYS, 1)[0];
  const airlineName = pick(AIRLINE_NAME_KEYS, 1)[0];
  const flightNumber = pick(FLIGHT_KEYS, 1)[0];
  const cabin = pick(CABIN_KEYS, 1)[0];
  const origin = pick(ORIGIN_KEYS, 1)[0];
  const destination = pick(DEST_KEYS, 1)[0];
  const seats = toNumber(pick(SEATS_KEYS, 1)[0]);

  const asString = (value: unknown): string | null =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

  const code = asString(airlineCode);
  const originCode = asString(origin);
  const destCode = asString(destination);

  return {
    priceAmount,
    priceText,
    departAt: toClockOrIso(depart),
    arriveAt: toClockOrIso(arrive),
    // Durations are often printed in minutes or as "95"; hours-as-float is ambiguous, so a
    // value below 24 is treated as minutes only when the key says so.
    durationMinutes: duration !== null && duration > 0 && duration < 60 * 24 ? Math.round(duration) : null,
    stops: stops !== null && stops >= 0 && stops < 6 ? Math.round(stops) : null,
    airlineCode: code && /^[A-Z0-9]{2,3}$/i.test(code) ? code.toUpperCase() : null,
    airlineName: asString(airlineName),
    flightNumber: (() => {
      const value = asString(flightNumber);
      return value && /^[A-Z0-9]{2}\s?-?\s?\d{1,4}$/i.test(value) ? value.replace(/\s|-/g, "") : null;
    })(),
    cabin: asString(cabin),
    originAirport: originCode && /^[A-Z]{3}$/i.test(originCode) ? originCode.toUpperCase() : null,
    destinationAirport: destCode && /^[A-Z]{3}$/i.test(destCode) ? destCode.toUpperCase() : null,
    seatsAvailable: seats !== null && seats >= 0 && seats < 1000 ? Math.round(seats) : null,
    usedKeys: used,
  };
}
