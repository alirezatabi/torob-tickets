/**
 * Fare-level facts shared by the demo catalog and price history.
 *
 * These two helpers are all that survived the removal of the real-data layer: identity
 * (`offerKey`) is computed from the *same* facts in the catalog demo data, in the search
 * pipeline and in the persistence layer, so a price-history line can never join two
 * different products.
 */

import type { BaggageInfo } from "@/domain/flight";
import { getCity } from "@/lib/cities";

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
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
