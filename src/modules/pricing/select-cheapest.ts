import type { CabinClass } from "@/domain/trip";
import type { FlightOffer, OfferGroup } from "@/domain/flight";

/**
 * **The** definition of "the cheapest price for this flight".
 *
 * A price comparison is only trustworthy if the number on the card, the number in the date
 * strip, the number in the top suggestion and the number in the API are produced by the same
 * rule. This module is that rule, and it is pure: same group + same options ⇒ same answer,
 * on any machine, forever.
 *
 * Eligibility (an offer is only a candidate for "cheapest" when all four hold):
 *   1. the price is comparable (`price.comparable !== false`) — a foreign-currency quote
 *      without an FX conversion cannot be compared to toman;
 *   2. freshness is not `unavailable` — the source said the price is gone;
 *   3. the cabin is the one the user asked for — business vs economy is another product;
 *   4. capacity: `seatsAvailable === null` means *unknown* (allowed), a number below the
 *      passenger count means not purchasable.
 *
 * Tie-break (deterministic, locale-independent): completeness, then freshest quote, then
 * `providerId` by code point.
 */

/** Seats this low are worth a visible warning; a named constant so UI and tests agree. */
export const LOW_SEATS_THRESHOLD = 5;

/**
 * How much more the "cheapest with baggage included" offer may cost before it stops being a
 * useful side-by-side alternative (15 %).
 */
export const BAGGAGE_PREMIUM_PERCENT = 15;

export interface CheapestOptions {
  passengers: number;
  /** Requested cabin; the default is what the form sends. */
  cabin?: CabinClass;
  /** Clock, injectable; only used for freshness tie-breaks and API compatibility. */
  now?: Date;
}

export type IneligibleReason =
  | "capacity"
  | "cabin"
  | "unavailable"
  | "not-comparable";

export interface IneligibleOffer {
  offer: FlightOffer;
  reason: IneligibleReason;
  /** Persian, displayable, no numbers the user cannot verify. */
  reasonFa: string;
}

export interface CheapestSelection {
  /** The purchasable, comparable, cheapest offer — or null when there is none. */
  cheapest: FlightOffer | null;
  /** Cheapest offer that actually includes checked baggage, when only slightly pricier. */
  cheapestWithBaggage: FlightOffer | null;
  /** Offers excluded from the comparison, with a reason each (never hidden silently). */
  ineligible: IneligibleOffer[];
  /** `highest - cheapest` across the *eligible* offers (0 when there is no spread). */
  spreadToman: number;
  /** What the user saves by taking `cheapest` instead of the priciest eligible offer. */
  savingsToman: number;
  /** Total for all passengers at the cheapest eligible price (null when none is eligible). */
  totalToman: number | null;
  /** Seats on this flight: max of the known, purchasable offers; null when nobody says. */
  seatsAvailable: number | null;
}

export const INELIGIBLE_LABELS: Record<IneligibleReason, string> = {
  capacity: "ظرفیت کافی نیست",
  cabin: "کلاس کابین متفاوت است",
  unavailable: "نرخ دیگر در دسترس نیست",
  "not-comparable": "قیمت به ارز خارجی است و قابل مقایسه نیست",
};

export function isPurchasable(offer: FlightOffer, passengers: number): boolean {
  return offer.seatsAvailable === null || typeof offer.seatsAvailable === "undefined"
    ? true
    : offer.seatsAvailable >= passengers;
}

function eligibility(offer: FlightOffer, options: CheapestOptions): IneligibleReason | null {
  if (offer.price.comparable === false) return "not-comparable";
  if (offer.freshness === "unavailable") return "unavailable";
  if (options.cabin && offer.cabin !== options.cabin) return "cabin";
  if (!isPurchasable(offer, options.passengers)) return "capacity";
  return null;
}

function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Cheapest first; ties by completeness, freshness, then provider id (code point). */
export function compareEligible(a: FlightOffer, b: FlightOffer): number {
  if (a.price.toman !== b.price.toman) return a.price.toman - b.price.toman;
  const completeness = (b.completeness ?? 0) - (a.completeness ?? 0);
  if (completeness !== 0) return completeness;
  const freshness = new Date(b.providerUpdatedAt).getTime() - new Date(a.providerUpdatedAt).getTime();
  if (freshness !== 0) return freshness;
  return byCodePoint(a.providerId, b.providerId) || byCodePoint(a.id, b.id);
}

function hasCheckedBaggage(offer: FlightOffer): boolean {
  return offer.baggage.checked === "included";
}

/**
 * Capacity of the **flight**, from the offers we can prove.
 *
 * Never a sum: several sellers quote the same physical aircraft, so adding their numbers up
 * would invent seats that do not exist. The honest aggregate is the maximum any one
 * purchasable seller claims — and `null` (unknown) when no source states a number.
 */
export function flightCapacity(
  offers: FlightOffer[],
  options: { passengers?: number } = {},
): number | null {
  const passengers = options.passengers ?? 1;
  let max: number | null = null;
  for (const offer of offers) {
    if (typeof offer.seatsAvailable !== "number") continue;
    const reason = eligibility(offer, { passengers });
    if (reason) continue;
    if (max === null || offer.seatsAvailable > max) max = offer.seatsAvailable;
  }
  if (max !== null) return max;
  // Every eligible offer was excluded for capacity: the flight is sold out, which is a fact
  // about the flight (0 seats), not an unknown.
  const stated = offers.some((offer) => typeof offer.seatsAvailable === "number");
  return stated && offers.every((offer) => typeof offer.seatsAvailable === "number") ? 0 : null;
}

/** True when no offer for this flight can be bought for the requested passenger count. */
export function isSoldOut(group: OfferGroup, passengers: number): boolean {
  return selectCheapestOffer(group, { passengers }).cheapest === null;
}

/**
 * The single selection function. Every surface (card, date strip, suggestion, API) calls
 * this instead of sorting prices itself.
 */
export function selectCheapestOffer(group: OfferGroup, options: CheapestOptions): CheapestSelection {
  const passengers = Math.max(1, Math.trunc(options.passengers));
  const ineligible: IneligibleOffer[] = [];
  const eligible: FlightOffer[] = [];

  for (const offer of group.offers) {
    const reason = eligibility(offer, { ...options, passengers });
    if (reason) ineligible.push({ offer, reason, reasonFa: INELIGIBLE_LABELS[reason] });
    else eligible.push(offer);
  }

  const sorted = [...eligible].sort(compareEligible);
  const cheapest = sorted[0] ?? null;
  const highest = sorted[sorted.length - 1] ?? null;
  const spreadToman = cheapest && highest ? highest.price.toman - cheapest.price.toman : 0;

  // "Cheapest with baggage": only useful next to a cheapest offer that does *not* include
  // baggage, and only when it is close enough in price to be a real alternative.
  let cheapestWithBaggage: FlightOffer | null = null;
  if (cheapest && !hasCheckedBaggage(cheapest)) {
    const withBag = sorted.find(hasCheckedBaggage);
    if (withBag && withBag.price.toman <= cheapest.price.toman * (1 + BAGGAGE_PREMIUM_PERCENT / 100)) {
      cheapestWithBaggage = withBag;
    }
  }

  return {
    cheapest,
    cheapestWithBaggage,
    ineligible,
    spreadToman,
    savingsToman: spreadToman,
    totalToman: cheapest ? cheapest.price.toman * passengers : null,
    seatsAvailable: flightCapacity(group.offers, { passengers }),
  };
}

/** Convenience for surfaces that only need the price of a day: cheapest *or* null. */
export function cheapestTomanFor(group: OfferGroup, passengers: number): number | null {
  return selectCheapestOffer(group, { passengers }).cheapest?.price.toman ?? null;
}
