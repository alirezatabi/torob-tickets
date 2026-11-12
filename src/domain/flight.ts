import type { CabinClass } from "./trip";

/**
 * Normalized flight offer — the single shape every provider adapter produces.
 *
 * Rules that keep AI grounded:
 *  - nothing is invented: unknown data is `null`, never a guessed default.
 *  - `price.toToman` is always present (converted with a disclosed demo FX table).
 *  - `duration` and `stops` are recomputed from segments instead of trusting a
 *    provider string.
 */
export interface FlightOffer {
  /** Stable id: provider id + raw provider offer id. */
  id: string;
  /** Id of the deduplicated group this offer belongs to. */
  groupKey: string;
  providerId: string;
  providerName: string;

  airlineCode: string;
  airlineName: string;
  flightNumber: string | null;

  originCode: string;
  destinationCode: string;
  /** ISO 8601 instants (UTC). */
  departAt: string;
  arriveAt: string;
  /** Recomputed from the segment timeline, in minutes. */
  durationMinutes: number;
  stops: number;
  segments: FlightSegment[];

  price: OfferPrice;
  baggage: BaggageInfo;
  refundable: boolean | null;
  cabin: CabinClass;
  offerUrl: string;
  /** ISO instant of the provider's own "last updated" field. */
  providerUpdatedAt: string;
  /** When *we* fetched it (drives the demo-data disclosure). */
  fetchedAt: string;
  dataSource: "demo" | "live";
  warnings: OfferWarning[];
}

export interface FlightSegment {
  airlineCode: string;
  flightNumber: string | null;
  originCode: string;
  destinationCode: string;
  departAt: string;
  arriveAt: string;
  aircraft: string | null;
}

export interface OfferPrice {
  /** Original quoted money, exactly as the provider sent it. */
  original: { amount: number; currency: string };
  /** Normalized price in toman (always present). */
  toman: number;
  /** True when an FX conversion was applied (UI must disclose it). */
  converted: boolean;
}

export interface BaggageInfo {
  checked: "included" | "not-included" | "unknown";
  /** Cabin carry-on allowance in kg, when the provider states it. */
  cabinKg: number | null;
  checkedKg: number | null;
}

export type OfferWarning =
  | "price-converted"
  | "baggage-unknown"
  | "refund-unknown"
  | "flight-number-missing"
  | "timezone-assumed";

export const WARNING_LABELS: Record<OfferWarning, string> = {
  "price-converted": "قیمت با نرخ نمونه به تومان تبدیل شده",
  "baggage-unknown": "اطلاعات بار ارائه‌دهنده در دسترس نیست",
  "refund-unknown": "شرایط استرداد اعلام نشده",
  "flight-number-missing": "شماره پرواز اعلام نشده",
  "timezone-assumed": "منطقهٔ زمانی از روی فرودگاه فرض شده",
};

/**
 * A flight after cross-provider deduplication. The same physical flight sold by
 * several providers becomes one group so the user compares real alternatives,
 * while every provider's own price stays visible.
 */
export interface OfferGroup {
  groupKey: string;
  /** Representative offer (cheapest, then freshest) used for card display. */
  primary: FlightOffer;
  /** All offers for this flight, cheapest first. */
  offers: FlightOffer[];
  /** Lowest normalized price in the group. */
  cheapestToman: number;
  /** Providers that sell this flight, cheapest first. */
  providers: GroupProvider[];
  /** True when the offers' prices differ enough to be worth surfacing. */
  hasPriceSpread: boolean;
}

export interface GroupProvider {
  providerId: string;
  providerName: string;
  priceToman: number;
  offerId: string;
  offerUrl: string;
  original: { amount: number; currency: string };
  converted: boolean;
}
