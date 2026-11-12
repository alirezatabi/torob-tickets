import type { CabinClass, DayPart, PricePreference, TripQuery, TripType } from "@/domain/trip";
import { DEFAULT_PREFERENCES } from "@/domain/trip";
import { isKnownCity } from "./cities";

/**
 * URL is the state container for a search: shareable, back-button friendly and
 * server-renderable. This module is the single (validated) reader/writer.
 */

export interface SearchParamsObject {
  origin?: string;
  destination?: string;
  /** ISO departure date. */
  date?: string;
  trip?: TripType;
  return?: string;
  pax?: string;
  cabin?: CabinClass;
  price?: PricePreference;
  stops?: string;
  bag?: string;
  refund?: string;
  time?: DayPart;
  airlines?: string;
  price_max?: string;
  sort?: "best" | "cheapest" | "fastest";
  q?: string;
}

export const SORT_KEYS = ["best", "cheapest", "fastest"] as const;
export type SortKeyParam = (typeof SORT_KEYS)[number];

/**
 * Turn raw (possibly hostile) query params into a valid `TripQuery`.
 * Unknown cities or malformed dates are rejected rather than guessed.
 */
export function parseSearchParams(
  raw: SearchParamsObject,
  defaults: { date: string },
): { ok: true; query: TripQuery } | { ok: false; reason: string; missing: string[] } {
  const missing: string[] = [];
  const origin = raw.origin?.toUpperCase();
  const destination = raw.destination?.toUpperCase();

  if (!origin || !isKnownCity(origin)) missing.push("origin");
  if (!destination || !isKnownCity(destination)) missing.push("destination");
  if (!raw.date || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) missing.push("date");

  if (missing.length > 0) {
    return { ok: false, reason: "پارامترهای جستجو کامل نیستند", missing };
  }

  if (origin === destination) {
    return { ok: false, reason: "مبدأ و مقصد نمی‌توانند یکسان باشند", missing: [] };
  }

  const pax = clampInt(raw.pax, 1, 9, 1);
  const stopsRaw = raw.stops === undefined || raw.stops === "" ? null : Number(raw.stops);

  return {
    ok: true,
    query: {
      mode: "flight",
      tripType: raw.trip === "roundtrip" ? "roundtrip" : "oneway",
      originCode: origin as string,
      destinationCode: destination as string,
      departDate: raw.date ?? defaults.date,
      returnDate: raw.return && /^\d{4}-\d{2}-\d{2}$/.test(raw.return) ? raw.return : null,
      passengers: pax,
      cabin: isCabin(raw.cabin) ? raw.cabin : "economy",
      filters: {
        ...DEFAULT_PREFERENCES,
        pricePreference: isPricePref(raw.price) ? raw.price : "balanced",
        maxStops: stopsRaw !== null && Number.isFinite(stopsRaw) ? clampInt(String(stopsRaw), 0, 3, 0) : null,
        baggageRequired: raw.bag === "1",
        refundableOnly: raw.refund === "1",
        dayPart: isDayPart(raw.time) ? raw.time : null,
        maxPriceToman: parseBudget(raw.price_max),
        preferredAirlines: (raw.airlines ?? "")
          .split(",")
          .map((a) => a.trim().toUpperCase())
          .filter((a) => a.length === 2),
      },
      ...(raw.q ? { rawText: raw.q } : {}),
    },
  };
}

/** Serialize a query back to URL params (omitting defaults keeps URLs clean). */
export function toSearchParams(query: TripQuery, sort?: SortKeyParam): URLSearchParams {
  const params = new URLSearchParams({
    origin: query.originCode,
    destination: query.destinationCode,
    date: query.departDate,
  });
  if (query.tripType === "roundtrip") params.set("trip", "roundtrip");
  if (query.returnDate) params.set("return", query.returnDate);
  if (query.passengers !== 1) params.set("pax", String(query.passengers));
  if (query.cabin !== "economy") params.set("cabin", query.cabin);
  if (query.filters.pricePreference !== "balanced") params.set("price", query.filters.pricePreference);
  if (query.filters.maxStops !== null) params.set("stops", String(query.filters.maxStops));
  if (query.filters.maxPriceToman !== null) params.set("price_max", String(query.filters.maxPriceToman));
  if (query.filters.baggageRequired) params.set("bag", "1");
  if (query.filters.refundableOnly) params.set("refund", "1");
  if (query.filters.dayPart) params.set("time", query.filters.dayPart);
  if (query.filters.preferredAirlines.length) params.set("airlines", query.filters.preferredAirlines.join(","));
  if (sort && sort !== "best") params.set("sort", sort);
  return params;
}

export function searchHref(query: TripQuery, extra: Record<string, string | null | undefined> = {}): string {
  const params = toSearchParams(query, (extra.sort as SortKeyParam | undefined) ?? undefined);
  for (const [key, value] of Object.entries(extra)) {
    if (key === "sort") continue;
    if (value === null || value === undefined || value === "") params.delete(key);
    else params.set(key, value);
  }
  return `/search?${params.toString()}`;
}

function parseBudget(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isCabin(value: string | undefined): value is CabinClass {
  return value === "economy" || value === "premium" || value === "business";
}
function isPricePref(value: string | undefined): value is PricePreference {
  return value === "low" || value === "balanced" || value === "comfort";
}
function isDayPart(value: string | undefined): value is DayPart {
  return (
    value === "early-morning" || value === "morning" || value === "afternoon" || value === "evening" || value === "night"
  );
}
function clampInt(value: string | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
