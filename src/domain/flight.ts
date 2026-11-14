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

  /**
   * Airport-level codes when the source states them (THR vs IKA). Absent/undefined
   * means "the source only told us the city" — never guess an airport.
   */
  originAirport?: string | null;
  destinationAirport?: string | null;
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
  dataSource: "demo" | "live" | "crawled";
  warnings: OfferWarning[];

  // ——— live-only facts (absent on demo offers) ———
  /** Fare identity: cabin, booking class, ticket type. */
  fare?: FareIdentity;
  /** Freshness of the *price*, not of the source. */
  freshness?: FreshnessState;
  /** Instant the price was observed (== fetchedAt unless re-verified). */
  priceObservedAt?: string;
  /** Instant the price+availability were last re-verified with the provider. */
  lastVerifiedAt?: string | null;
  /** 0..1 share of optional facts the source provided. */
  completeness?: number;
  provenance?: OfferProvenance;
  /** Bookable seats, only when the source states them. */
  seatsAvailable?: number | null;
}

/**
 * Fare identity. Two offers for the same physical flight are still *different
 * products* when the cabin, fare class, baggage or refund terms differ, and they
 * must never be merged or plotted on one price line.
 */
export interface FareIdentity {
  cabin: CabinClass;
  /** Marketing carrier's booking class ("Y", "RK") when the source states it. */
  fareClass: string | null;
  /** Charter vs system ticket, when known. */
  ticketType: "system" | "charter" | "unknown";
  /** Marketing name of the fare family ("Economy Flex"), when known. */
  fareName: string | null;
}

export type FreshnessState = "fresh" | "possibly-stale" | "unverified" | "unavailable" | "demo";

export interface OfferProvenance {
  /** "html" for scraped pricing, "api" for a documented API, "demo" for fixtures. */
  sourceKind: "html" | "api" | "demo";
  /** Endpoint/URL the record came from (already fetched, no secrets). */
  endpoint: string;
  /** The provider's own record id, when it has one. */
  rawRecordId: string | null;
  /** Seller/agency label inside an aggregator (Sepehr360), when the source exposes it. */
  sellerLabel: string | null;
  /** True when a unit conversion (rial→toman) was applied. */
  unitConverted: boolean;
  /** Number of source rows that collapsed into this offer (intra-provider duplicates). */
  mergedRows: number;
  /**
   * How many independent agencies this source says sell this fare ("فروش توسط 125 سایت
   * مختلف"). A floor on real competition for *the same flight*; null when the source does
   * not say, which is not the same as "one".
   */
  sellerCount: number | null;
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
  /**
   * False when the offer is quoted in a currency we cannot convert to toman without an
   * FX feed (every Amadeus price). Such an offer is shown in its own currency and is
   * never mixed into toman rankings or price history lines.
   */
  comparable?: boolean;
}

export interface BaggageInfo {
  checked: "included" | "not-included" | "unknown";
  /** Cabin carry-on allowance in kg, when the provider states it. */
  cabinKg: number | null;
  checkedKg: number | null;
}

export type OfferWarning =
  | "price-converted"
  | "rial-to-toman"
  | "currency-assumed"
  | "baggage-unknown"
  | "refund-unknown"
  | "flight-number-missing"
  | "timezone-assumed"
  | "duration-inferred"
  | "airport-unknown"
  | "availability-unverified"
  | "seller-aggregated"
  | "stops-partial"
  | "price-foreign"
  | "source-test-environment";

export const WARNING_LABELS: Record<OfferWarning, string> = {
  "price-converted": "قیمت با نرخ تبدیل نمونه به تومان تبدیل شده",
  "rial-to-toman": "قیمت ریالی به تومان تبدیل شده (هر ۱۰ ریال = ۱ تومان)",
  "currency-assumed": "واحد قیمت از روی دادهٔ منبع مشخص نیست",
  "baggage-unknown": "اطلاعات بار ارائه‌دهنده در دسترس نیست",
  "refund-unknown": "شرایط استرداد اعلام نشده",
  "flight-number-missing": "شماره پرواز اعلام نشده",
  "timezone-assumed": "زمان‌های محلی با منطقهٔ Asia/Tehran تفسیر شده‌اند",
  "duration-inferred": "مدت سفر از روی ساعت حرکت و رسیدن محاسبه شده",
  "airport-unknown": "فرودگاه دقیق اعلام نشده (سطح شهر)",
  "availability-unverified": "موجودی این نرخ توسط منبع اعلام نشده است",
  "seller-aggregated": "این نرخ از میان چند فروشندهٔ همان منبع انتخاب شده",
  "stops-partial": "تعداد توقف اعلام شده، اما ایستگاه‌های میانی اعلام نشده‌اند",
  "price-foreign": "قیمت به ارز خارجی است و بدون نرخ تبدیل، قابل مقایسه با تومان نیست",
  "source-test-environment": "این داده از محیط تست منبع آمده و قیمت واقعی/زنده نیست",
};

/**
 * A flight after cross-provider deduplication. The same physical flight sold by
 * several providers becomes one group so the user compares real alternatives,
 * while every provider's own price stays visible.
 */
/**
 * One *physical flight*, and every price we found for exactly that flight.
 *
 * This is the unit the product promises to compare: `IR 452` on 29 Aban is one thing, and
 * what varies between sources is its *price*, not its identity. A group is therefore only
 * ever formed from offers that agree on carrier and flight number (see `dedupe/group.ts`);
 * two different flights are never put in one card, however close their prices are.
 */
export interface OfferGroup {
  groupKey: string;
  /** Representative offer (cheapest, then freshest) used for card display. */
  primary: FlightOffer;
  /** All offers for this flight, cheapest first. */
  offers: FlightOffer[];
  /** Lowest normalized price in the group. */
  cheapestToman: number;
  /** Sellers of *this* flight, cheapest first. */
  providers: GroupProvider[];
  /** True when the offers' prices differ enough to be worth surfacing. */
  hasPriceSpread: boolean;
  /** The carrier's flight number, when at least one source published it. */
  flightNumber: string | null;
  /**
   * How the flight's identity was established — printed in the UI, because a comparison is
   * only as trustworthy as the identity behind it.
   */
  identity: GroupIdentity;
  /**
   * Lower bound on how many independent sellers offered this exact flight. Sepehr360
   * publishes "فروش توسط N سایت مختلف" per fare, so the *seller* count can be far higher
   * than the provider count; we report it as a floor and never invent the individual names.
   */
  knownSellers: number;
}

export type GroupIdentity =
  /** Carrier + published flight number — the only fully trustworthy identity. */
  | "flight-number"
  /**
   * No source published a number; the same carrier's offers agree on departure within a
   * few minutes, so they are almost certainly one flight. Labelled in the UI as such.
   */
  | "same-departure";

export interface GroupProvider {
  providerId: string;
  providerName: string;
  priceToman: number;
  offerId: string;
  offerUrl: string;
  original: { amount: number; currency: string };
  converted: boolean;
}
