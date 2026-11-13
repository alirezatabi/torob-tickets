/**
 * Search entry point used by `/api/live/search` and the `/live` page.
 *
 * This build has **no real-data layer**: there is no network call, no scraper and no
 * provider key. Every offer below is generated in-process by the demo adapters, and the
 * payload says so (`mode: "demo"`, `dataSource: "demo"`, warning `demo-mode`).
 *
 * Responsibilities kept here (not in the route, not in the page):
 *   • run the demo providers and the deterministic ranking core;
 *   • group offers into *physical flights* with every seller's price;
 *   • persist — but never let a persistence failure break the response;
 *   • return a payload that carries its own *evidence*: how many rows each provider
 *     produced, what each price's freshness state is, and what is sample data.
 */

import type { FlightOffer } from "@/domain/flight";
import type { TripQuery } from "@/domain/trip";
import { rankAndDecide } from "@/modules/ranking/core";
import { fromDemoOffer } from "@/modules/ranking/project";
import type { RankInput } from "@/modules/ranking/types";
import { describeDemoProviders, SEARCH_MODE, type ProviderRunReport, type SearchMode } from "@/modules/catalog/demo-providers";
import { groupOffers } from "@/dedupe/group";
import { selectCheapestOffer, type CheapestSelection } from "@/modules/pricing/select-cheapest";
import type { OfferGroup } from "@/domain/flight";
import { persistSearch } from "@/modules/persistence/live-store";
import { dbMode } from "@/modules/db/prisma";
import { runSearch } from "@/providers/search";

export interface LiveSearchPayload {
  mode: SearchMode;
  query: {
    originCity: string;
    destinationCity: string;
    departDate: string;
    passengers: number;
    cabin: string;
  };
  offers: LiveOfferView[];
  reports: ProviderRunReport[];
  ranking: {
    best: string | null;
    cheapest: string | null;
    fastest: string | null;
    weights: Record<string, number>;
  };
  providers: ReturnType<typeof describeDemoProviders>;
  warnings: string[];
  persistence: { attempted: boolean; ok: boolean; deduped: boolean; searchId: string | null; reasonFa: string | null };
  /** When an offer's price was observed at the source, i.e. "as of". */
  fetchedAt: string;
  totalMs: number;
}

export interface LiveOfferView {
  id: string;
  providerId: string;
  providerName: string;
  airlineCode: string;
  airlineName: string;
  flightNumber: string | null;
  originCity: string;
  destinationCity: string;
  originAirport: string | null;
  destinationAirport: string | null;
  departAt: string;
  arriveAt: string;
  durationMinutes: number;
  stops: number;
  cabin: string;
  fareClass: string | null;
  ticketType: string;
  baggage: { checked: string; checkedKg: number | null };
  refundable: boolean | null;
  price: { toman: number; currency: string; amountMinor: number; comparable: boolean; converted: boolean };
  freshness: string;
  priceObservedAt: string | null;
  lastVerifiedAt: string | null;
  seatsAvailable: number | null;
  completeness: number;
  offerUrl: string;
  sellerLabel: string | null;
  warnings: string[];
  badges: string[];
  score: number;
  feasible: boolean;
  violations: string[];
  dataSource: "live" | "demo";
}

/**
 * One row in the live results: a *flight*, with every source's price for that same flight.
 * `prices` always contains the displayed quote (cheapest first), so the card can show both
 * "what you would pay" and "what each source asks for the same seat".
 */
export interface LiveGroupView extends LiveOfferView {
  groupKey: string;
  identity: "flight-number" | "same-departure";
  knownSellers: number;
  /** How many sources we actually have a price from. */
  providerCount: number;
  /** One row per source selling this exact flight, cheapest first. */
  prices: QuoteView[];
  /**
   * The shared pricing verdict (`selectCheapestOffer`): the same rule the demo results page
   * and `/api/search` use. `cheapestOfferId` is null when nothing is purchasable.
   */
  cheapestOfferId: string | null;
  /** Seats on this flight: max of the known purchasable quotes, or null when unknown. */
  seatsAvailable: number | null;
  /** True when no source can serve the requested passenger count. */
  soldOut: boolean;
}

export interface QuoteView {
  id: string;
  providerId: string;
  providerName: string;
  priceToman: number;
  isCheapest: boolean;
  /** What *this* source says about seats; null means it did not say. */
  seatsAvailable: number | null;
}

export interface LiveSearchOptions {
  /** Kept for API compatibility; the only accepted value is `"demo"`. */
  mode?: SearchMode;
  persist?: boolean;
  sort?: "best" | "cheapest" | "fastest" | "earliest";
  /** Injectable clock, so tests and the date strip are reproducible. */
  now?: Date;
}

export async function runLiveSearch(query: TripQuery, options: LiveSearchOptions = {}): Promise<LiveSearchPayload> {
  const startedAt = Date.now();
  const mode: SearchMode = SEARCH_MODE;
  const warnings: string[] = ["demo-mode"];

  const outcome = await runSearch(query, { now: options.now });
  const offers: FlightOffer[] = outcome.offers;
  const reports: ProviderRunReport[] = outcome.health.map((health) => ({
    providerId: health.id,
    providerName: health.name,
    mode: "demo",
    ok: health.ok,
    accepted: health.returned,
    rejected: health.rejected,
    rawCount: outcome.rawCounts[health.id] ?? 0,
    latencyMs: health.latencyMs,
    retries: 0,
    error: health.error ? { code: "demo-provider-failed", summaryFa: "تولید دادهٔ نمونه برای این منبع ناموفق بود" } : null,
    fetchedAt: outcome.fetchedAt,
    fromCache: false,
  }));

  const inputs: RankInput[] = offers.map((offer) => fromDemoOffer(offer));
  const ranked = rankAndDecide(inputs, query.filters);
  const byId = new Map(offers.map((offer) => [offer.id, offer]));

  if (options.sort === "cheapest") {
    ranked.ranked.sort((a, b) => a.input.priceToman - b.input.priceToman || a.input.durationMinutes - b.input.durationMinutes);
  } else if (options.sort === "earliest") {
    ranked.ranked.sort(
      (a, b) =>
        new Date(a.input.departAt).getTime() - new Date(b.input.departAt).getTime() ||
        a.input.priceToman - b.input.priceToman,
    );
  } else if (options.sort === "fastest") {
    ranked.ranked.sort((a, b) => a.input.durationMinutes - b.input.durationMinutes || a.input.priceToman - b.input.priceToman);
  }

  const views: LiveOfferView[] = ranked.ranked
    .map((entry) => {
      const offer = byId.get(entry.input.id);
      if (!offer) return null;
      return toView(offer, entry.score, entry.feasible, entry.violations, entry.badges);
    })
    .filter((view): view is LiveOfferView => view !== null);

  // The list is *flights*, not offers: one row per physical flight, every source's price for
  // exactly that flight underneath. Ranked offers are folded into the group they belong to,
  // and the group's cheapest quote is the one the row displays.
  const groups = groupOffers(offers);
  const selectionByGroup = new Map<string, CheapestSelection>(
    groups.map((group) => [
      group.groupKey,
      selectCheapest(group, query.passengers ?? 1, query.cabin),
    ]),
  );
  const groupViews: LiveGroupView[] = groups
    .map((group) => {
      const selection = selectionByGroup.get(group.groupKey);
      const cheapestId = selection?.cheapest?.id ?? null;
      const row = views.find((view) => view.id === (cheapestId ?? group.primary.id));
      const seatsByOffer = new Map(
        group.offers.map((offer) => [offer.id, typeof offer.seatsAvailable === "number" ? offer.seatsAvailable : null]),
      );
      if (!row) return null;
      return {
        ...row,
        groupKey: group.groupKey,
        flightNumber: group.flightNumber ?? row.flightNumber,
        identity: group.identity,
        knownSellers: group.knownSellers,
        providerCount: group.providers.length,
        prices: group.providers.map((provider) => ({
          id: provider.offerId,
          providerId: provider.providerId,
          providerName: provider.providerName,
          priceToman: provider.priceToman,
          isCheapest: provider.offerId === cheapestId,
          seatsAvailable: seatsByOffer.get(provider.offerId) ?? null,
        })),
        cheapestOfferId: cheapestId,
        seatsAvailable: selection?.seatsAvailable ?? null,
        soldOut: cheapestId === null,
      } satisfies LiveGroupView;
    })
    .filter((view): view is LiveGroupView => view !== null)
    // Sold out flights last, exactly like the demo list.
    .sort((a, b) => Number(a.soldOut) - Number(b.soldOut));

  const persistence = await persistIfPossible(query, reports, offers, options.persist ?? true);

  const badgeId = (decision: string) =>
    ranked.ranked.find((entry) => entry.badges.includes(decision as never))?.input.id ?? null;

  return {
    mode,
    query: {
      originCity: query.originCode,
      destinationCity: query.destinationCode,
      departDate: query.departDate,
      passengers: query.passengers ?? 1,
      cabin: String(query.cabin ?? "economy"),
    },
    offers: groupViews.length > 0 ? groupViews : views,
    reports,
    ranking: {
      best: badgeId("best"),
      cheapest: badgeId("cheapest"),
      fastest: badgeId("fastest"),
      weights: ranked.weights,
    },
    providers: describeDemoProviders(),
    warnings,
    persistence,
    fetchedAt: offers[0]?.fetchedAt ?? new Date().toISOString(),
    totalMs: Date.now() - startedAt,
  };
}

function toView(
  offer: FlightOffer,
  score: number,
  feasible: boolean,
  violations: string[],
  badges: string[],
): LiveOfferView {
  return {
    id: offer.id,
    providerId: offer.providerId,
    providerName: offer.providerName,
    airlineCode: offer.airlineCode,
    airlineName: offer.airlineName,
    flightNumber: offer.flightNumber,
    originCity: offer.originCode,
    destinationCity: offer.destinationCode,
    originAirport: offer.originAirport ?? null,
    destinationAirport: offer.destinationAirport ?? null,
    departAt: offer.departAt,
    arriveAt: offer.arriveAt,
    durationMinutes: offer.durationMinutes,
    stops: offer.stops,
    cabin: offer.cabin,
    fareClass: offer.fare?.fareClass ?? null,
    ticketType: offer.fare?.ticketType ?? "unknown",
    baggage: { checked: offer.baggage.checked, checkedKg: offer.baggage.checkedKg },
    refundable: offer.refundable,
    price: {
      toman: offer.price.toman,
      currency: offer.price.original.currency,
      amountMinor: offer.price.original.amount,
      comparable: offer.price.comparable !== false,
      converted: offer.price.converted,
    },
    freshness: offer.freshness ?? (offer.dataSource === "demo" ? "demo" : "unverified"),
    priceObservedAt: offer.priceObservedAt ?? null,
    lastVerifiedAt: offer.lastVerifiedAt ?? null,
    seatsAvailable: offer.seatsAvailable ?? null,
    completeness: offer.completeness ?? (offer.dataSource === "demo" ? 1 : 0),
    offerUrl: offer.offerUrl,
    sellerLabel: offer.provenance?.sellerLabel ?? null,
    warnings: offer.warnings,
    badges,
    score,
    feasible,
    violations,
    dataSource: offer.dataSource,
  };
}

/** The shared pricing rule, applied to this build's (demo) groups. */
function selectCheapest(group: OfferGroup, passengers: number, cabin: string | undefined): CheapestSelection {
  return selectCheapestOffer(group, {
    passengers,
    ...(cabin === "economy" || cabin === "premium" || cabin === "business" ? { cabin } : {}),
  });
}

/**
 * Persist best-effort. A DB failure is *reported*, never thrown: the user still gets
 * their prices, and the payload says history was not recorded.
 */
async function persistIfPossible(
  query: TripQuery,
  reports: ProviderRunReport[],
  offers: FlightOffer[],
  enabled: boolean,
): Promise<LiveSearchPayload["persistence"]> {
  if (!enabled) {
    return { attempted: false, ok: false, deduped: false, searchId: null, reasonFa: "ذخیره‌سازی غیرفعال است" };
  }
  if (dbMode() === "off") {
    return {
      attempted: false,
      ok: false,
      deduped: false,
      searchId: null,
      reasonFa: "دیتابیس پیکربندی نشده؛ تاریخچهٔ قیمت ثبت نمی‌شود",
    };
  }
  if (offers.length === 0 && reports.length === 0) {
    return { attempted: false, ok: false, deduped: false, searchId: null, reasonFa: "چیزی برای ذخیره نبود" };
  }

  try {
    const result = await persistSearch({
      query: {
        originCity: query.originCode,
        destinationCity: query.destinationCode,
        departDate: query.departDate,
        passengers: query.passengers ?? 1,
        cabin: String(query.cabin ?? "economy"),
      },
      mode: "DEMO",
      startedAt: new Date(),
      reports,
      offers,
    });
    return { attempted: true, ok: true, deduped: result.deduped, searchId: result.searchId, reasonFa: null };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      deduped: false,
      searchId: null,
      reasonFa: error instanceof Error ? error.message : "ذخیره‌سازی ناموفق بود",
    };
  }
}
