/**
 * Live search entry point used by the API and the search page.
 *
 * Responsibilities kept here (not in the route, not in the page):
 *   • run the orchestrator;
 *   • hand the raw result to the deterministic ranking core;
 *   • persist — but never let a persistence failure break the response;
 *   • return a payload that carries its own *evidence*: which providers answered, how
 *     fresh each price is, what could not be verified, and whether the user is looking
 *     at live or demo data.
 */

import type { FlightOffer } from "@/domain/flight";
import type { TripQuery } from "@/domain/trip";
import { rankAndDecide } from "@/modules/ranking/core";
import { fromDemoOffer, fromLiveOffer } from "@/modules/ranking/project";
import type { RankInput } from "@/modules/ranking/types";
import { createOrchestrator, describeLiveProviders, searchMode, type SearchMode } from "@/modules/providers/registry-live";
import type { ProviderRunReport } from "@/modules/providers/contracts/provider";
import { persistSearch } from "@/modules/persistence/live-store";
import { dbMode } from "@/modules/db/prisma";
import { getDemoOffers } from "@/server/live-search-demo";

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
  providers: ReturnType<typeof describeLiveProviders>;
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

export interface LiveSearchOptions {
  mode?: SearchMode;
  persist?: boolean;
  sort?: "best" | "cheapest" | "fastest";
}

export async function runLiveSearch(query: TripQuery, options: LiveSearchOptions = {}): Promise<LiveSearchPayload> {
  const startedAt = Date.now();
  const mode = options.mode ?? searchMode();
  const warnings: string[] = [];
  let offers: FlightOffer[] = [];
  let reports: ProviderRunReport[] = [];

  if (mode === "live") {
    const orchestrator = createOrchestrator();
    const outcome = await orchestrator.search(query);
    offers = outcome.offers;
    reports = outcome.reports;
    warnings.push(...outcome.warnings);
  } else {
    offers = await getDemoOffers(query);
    warnings.push("demo-mode");
  }

  const inputs: RankInput[] = offers.map((offer) =>
    offer.dataSource === "live" ? fromLiveOffer(offer) : fromDemoOffer(offer),
  );
  const ranked = rankAndDecide(inputs, query.filters);
  const byId = new Map(offers.map((offer) => [offer.id, offer]));

  if (options.sort === "cheapest") {
    ranked.ranked.sort((a, b) => a.input.priceToman - b.input.priceToman || a.input.durationMinutes - b.input.durationMinutes);
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

  const persistence = await persistIfPossible(query, reports, offers, mode, options.persist ?? true);

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
    offers: views,
    reports,
    ranking: {
      best: badgeId("best"),
      cheapest: badgeId("cheapest"),
      fastest: badgeId("fastest"),
      weights: ranked.weights,
    },
    providers: describeLiveProviders(),
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
    completeness: offer.completeness ?? 0,
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

/**
 * Persist best-effort. A DB failure is *reported*, never thrown: the user still gets
 * their prices, and the payload says history was not recorded.
 */
async function persistIfPossible(
  query: TripQuery,
  reports: ProviderRunReport[],
  offers: FlightOffer[],
  mode: SearchMode,
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
      requestHash: "",
      query: {
        originCity: query.originCode,
        destinationCity: query.destinationCode,
        departDate: query.departDate,
        passengers: query.passengers ?? 1,
        cabin: String(query.cabin ?? "economy"),
      },
      mode: mode === "live" ? "LIVE" : "DEMO",
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
