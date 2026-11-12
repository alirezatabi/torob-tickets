/**
 * Amadeus response parsing.
 *
 * Three things matter here and nothing else does:
 *   1. the **environment** is carried on every record, because test data is cached
 *      sample data and must never be presented as a live price (correction #1);
 *   2. money arrives as a decimal *string* in a foreign currency — it is parsed to an
 *      integer minor amount, and never converted to toman with a made-up FX rate;
 *   3. times arrive as local wall clocks without an offset, so they are rebuilt into
 *      instants using the airport's real timezone.
 */

import type {
  AmadeusFlightOffersResponse,
  AmadeusOffer,
  AmadeusPricingResponse,
  AmadeusTravelerPricing,
} from "./types";

export type AmadeusEnv = "test" | "production";

export interface AmadeusRawOffer {
  /** Amadeus' own offer id (base64-ish, opaque). Used for re-pricing. */
  id: string;
  env: AmadeusEnv;
  source: string | null;
  validatingAirlineCode: string | null;
  itineraries: AmadeusOffer["itineraries"];
  price: AmadeusOffer["price"];
  numberOfBookableSeats: number | null;
  lastTicketingDate: string | null;
  instantTicketingRequired: boolean;
  travelerPricings: AmadeusTravelerPricing[] | null;
  dictionaries: AmadeusFlightOffersResponse["dictionaries"] | null;
  /** The complete original offer, needed verbatim for `/pricing`. */
  raw: AmadeusOffer;
}

export interface AmadeusParseResult {
  offers: AmadeusRawOffer[];
  /** Amadeus-reported count (meta.count), when present. */
  declaredCount: number | null;
  warnings: string[];
}

export function parseFlightOffersResponse(
  payload: unknown,
  env: AmadeusEnv,
): AmadeusParseResult {
  const response = payload as AmadeusFlightOffersResponse | null;
  if (!response || typeof response !== "object") {
    return { offers: [], declaredCount: null, warnings: ["empty-response"] };
  }

  const warnings: string[] = [];
  if (response.errors && response.errors.length > 0) {
    // Amadeus can return HTTP 200 with an errors array; do not treat that as data.
    warnings.push(...response.errors.map((error) => `amadeus-error-${error.code ?? error.status ?? "unknown"}`));
  }
  if (response.warnings) {
    warnings.push(...response.warnings.map((warning) => `amadeus-warning-${warning.code ?? "unknown"}`));
  }

  const data = Array.isArray(response.data) ? response.data : [];
  const offers = data
    .filter((offer): offer is AmadeusOffer => Boolean(offer && offer.id && Array.isArray(offer.itineraries)))
    .map<AmadeusRawOffer>((offer) => ({
      id: offer.id,
      env,
      source: offer.source ?? null,
      validatingAirlineCode: offer.validatingAirlineCodes?.[0] ?? null,
      itineraries: offer.itineraries,
      price: offer.price,
      numberOfBookableSeats:
        typeof offer.numberOfBookableSeats === "number" ? offer.numberOfBookableSeats : null,
      lastTicketingDate: offer.lastTicketingDate ?? null,
      instantTicketingRequired: offer.instantTicketingRequired === true,
      travelerPricings: offer.travelerPricings ?? null,
      dictionaries: response.dictionaries ?? null,
      raw: offer,
    }));

  return {
    offers,
    declaredCount: typeof response.meta?.count === "number" ? response.meta.count : null,
    warnings,
  };
}

export interface AmadeusRepricingResult {
  ok: boolean;
  /** NEW total when the airline changed the price during verification. */
  total: { amount: number; currency: string } | null;
  /** Amadeus' own message when it refused to price the offer (e.g. expired). */
  reason: string | null;
}

/**
 * `POST /v1/shopping/flight-offers/pricing` re-checks price *and* availability right
 * now. It is the only way to honestly say "this price still holds".
 *
 * Distinguishing "price changed" from "price unavailable" matters: the first is a
 * normal market event (update the offer), the second means the fare is gone.
 */
export function parsePricingResponse(payload: unknown): AmadeusRepricingResult {
  const response = payload as AmadeusPricingResponse | null;
  const offer = response?.data?.flightOffers?.[0];
  if (!offer) {
    const detail = response?.errors?.[0]?.detail ?? response?.errors?.[0]?.title ?? null;
    return { ok: false, total: null, reason: detail ?? "no flight offer in pricing response" };
  }

  const parsed = parseAmountString(offer.price?.total ?? offer.price?.grandTotal ?? null);
  const currency = offer.price?.currency ?? null;
  if (parsed === null || !currency) {
    return { ok: false, total: null, reason: "pricing response has no usable total" };
  }
  return { ok: true, total: { amount: parsed, currency }, reason: null };
}

/**
 * "1234.56" → 123456 (integer minor units). Rejects anything that is not a plain
 * decimal; a localized string like "1,234.56" must be rejected rather than guessed.
 */
export function parseAmountString(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = `${match[2] ?? ""}00`.slice(0, 2);
  const amount = Number(`${whole}${fraction}`);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

/** ISO-8601 duration used by Amadeus: "PT2H15M", "PT45M", "P1DT2H". */
export function parseIsoDuration(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(value.trim());
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const total = days * 1440 + hours * 60 + minutes;
  return total > 0 ? total : null;
}

/**
 * Cabin comes from `travelerPricings[0].fareDetailsBySegment[n].cabin`.
 * Returns null when it is absent — we do not default to economy silently.
 */
export function extractCabin(offer: Pick<AmadeusRawOffer, "travelerPricings">): string | null {
  const details = offer.travelerPricings?.[0]?.fareDetailsBySegment ?? [];
  for (const detail of details) {
    if (detail.cabin) return detail.cabin.toUpperCase();
  }
  return null;
}

export function extractFareDetails(
  offer: Pick<AmadeusRawOffer, "travelerPricings">,
): AmadeusTravelerPricing["fareDetailsBySegment"] {
  return offer.travelerPricings?.[0]?.fareDetailsBySegment ?? [];
}

/** Checked-baggage allowance in kg, when the airline states a weight (not a count). */
export function extractCheckedBaggageKg(
  offer: Pick<AmadeusRawOffer, "travelerPricings">,
): { kg: number | null; included: boolean } {
  const details = offer.travelerPricings?.[0]?.fareDetailsBySegment ?? [];
  for (const detail of details) {
    const bags = detail.includedCheckedBags;
    if (!bags) continue;
    if (bags.weight && (bags.weightUnit ?? "KG").toUpperCase() === "KG") {
      return { kg: bags.weight, included: bags.weight > 0 };
    }
    if (typeof bags.quantity === "number") {
      // "1 piece" is not a weight; keep the allowance honest (20 kg is *not* assumed).
      return { kg: bags.quantity > 0 ? null : 0, included: bags.quantity > 0 };
    }
  }
  return { kg: null, included: false };
}
