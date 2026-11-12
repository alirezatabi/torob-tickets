import type { FlightOffer, OfferGroup } from "@/domain/flight";
import { DAY_PART_RANGES, type QueryPreferences } from "@/domain/trip";
import { getCity } from "./cities";
import { hourInZone } from "./format";

/**
 * Display filters.
 *
 * They operate on the already-normalized, already-grouped offers, so filtering
 * never changes prices or merges anything — it only hides.
 */
export interface DisplayFilters extends QueryPreferences {
  /** Upper bound in toman, applied to the group's cheapest price. */
  maxPriceToman: number | null;
}

export function offerMatchesFilters(offer: FlightOffer, filters: DisplayFilters): boolean {
  if (filters.maxPriceToman !== null && offer.price.toman > filters.maxPriceToman) return false;
  if (filters.maxStops !== null && offer.stops > filters.maxStops) return false;
  if (filters.baggageRequired && offer.baggage.checked !== "included") return false;
  if (filters.refundableOnly && offer.refundable !== true) return false;
  if (filters.preferredAirlines.length > 0 && !filters.preferredAirlines.includes(offer.airlineCode)) return false;
  if (filters.dayPart) {
    const [start, end] = DAY_PART_RANGES[filters.dayPart];
    const hour = hourInZone(offer.departAt, getCity(offer.originCode)?.timezone ?? "Asia/Tehran");
    if (hour < start || hour >= end) return false;
  }
  return true;
}

/** Filter offers inside a group; drop groups with nothing left. */
export function filterGroups(groups: OfferGroup[], filters: DisplayFilters): { visible: OfferGroup[]; hidden: number } {
  const visible: OfferGroup[] = [];
  let hidden = 0;

  for (const group of groups) {
    const offers = group.offers.filter((offer) => offerMatchesFilters(offer, filters));
    if (offers.length === 0) {
      hidden += 1;
      continue;
    }
    if (offers.length === group.offers.length) {
      visible.push(group);
      continue;
    }
    const primary = offers[0] ?? group.primary;
    visible.push({
      ...group,
      offers,
      primary,
      cheapestToman: offers[0]?.price.toman ?? group.cheapestToman,
      providers: group.providers.filter((provider) => offers.some((offer) => offer.id === provider.offerId)),
    });
  }

  return { visible, hidden };
}

/** Airline codes present in the result set, for rendering the filter options. */
export function airlineOptions(groups: OfferGroup[]): { code: string; name: string; count: number }[] {
  const map = new Map<string, { code: string; name: string; count: number }>();
  for (const group of groups) {
    const offer = group.primary;
    const existing = map.get(offer.airlineCode);
    if (existing) existing.count += 1;
    else map.set(offer.airlineCode, { code: offer.airlineCode, name: offer.airlineName, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** Price bounds in toman across the result set (for the range slider). */
export function priceBounds(groups: OfferGroup[]): { min: number; max: number } {
  if (groups.length === 0) return { min: 0, max: 0 };
  const prices = groups.map((group) => group.cheapestToman);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}
