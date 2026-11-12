/**
 * Sepehr360 URL construction.
 *
 * The only verified, server-rendered entry point is the B2C search page:
 *   https://sepehr360.ir/Flight/B2c/Search?origin=THR&destination=MHD&departureDate=1404-08-22
 *
 * Two constraints come from the real site and are encoded here:
 *   • `departureDate` is **Jalali** `YYYY-MM-DD`, not Gregorian (Gregorian dates return
 *     an empty result list, which looks exactly like "no flights" — a wrong date must
 *     therefore fail loudly here, not silently in the parser);
 *   • unknown airport pairs return the same empty page, so we only build URLs for
 *     cities in our catalogue and treat an empty parse as "no offers", never as an error.
 *
 * We do not use the bare `/{ORIG}/{DEST}` or sitemap-slug URLs: they 404 unless the
 * slug is exactly right, which is not a documented contract.
 */

import { isoToJalali } from "@/lib/jalali";
import { getCity } from "@/lib/cities";
import { airportsForCity } from "@/modules/airports";

export const SEPEHR360_BASE = "https://sepehr360.ir";
export const SEPEHR360_HOST = "sepehr360.ir";

export interface Sepehr360UrlInput {
  originCity: string;
  destinationCity: string;
  /** Gregorian civil date YYYY-MM-DD. */
  departDate: string;
}

export interface Sepehr360UrlResult {
  url: string;
  /** Airport codes actually used in the URL. */
  originAirport: string;
  destinationAirport: string;
  /** Jalali date used in the query string. */
  jalaliDate: string;
}

/**
 * Build the search URL for a city pair. Domestic Iranian routes are served from the
 * city's domestic airport (THR = Mehrabad); international routes from the
 * international one (IKA). This mirrors what the site itself does for its own links.
 */
export function buildSearchUrl(input: Sepehr360UrlInput): Sepehr360UrlResult {
  const origin = getCity(input.originCity);
  const destination = getCity(input.destinationCity);
  if (!origin || !destination) throw new Error(`unknown city ${input.originCity}>${input.destinationCity}`);

  const international = origin.country !== destination.country;
  const originAirport = airportsForCity(origin.code, { international })[0] ?? origin.code;
  const destinationAirport = airportsForCity(destination.code, { international })[0] ?? destination.code;

  const jalaliDate = toJalaliQueryDate(input.departDate);
  const url = new URL("/Flight/B2c/Search", SEPEHR360_BASE);
  url.searchParams.set("origin", originAirport);
  url.searchParams.set("destination", destinationAirport);
  url.searchParams.set("departureDate", jalaliDate);

  return { url: url.toString(), originAirport, destinationAirport, jalaliDate };
}

/** Gregorian `YYYY-MM-DD` → the site's own `YYYY-MM-DD` Jalali query value. */
export function toJalaliQueryDate(iso: string): string {
  const { year, month, day } = isoToJalali(iso);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The public page a user can open to see the same search (no per-offer link exists). */
export function searchPageUrl(input: Sepehr360UrlInput): string {
  return buildSearchUrl(input).url;
}
