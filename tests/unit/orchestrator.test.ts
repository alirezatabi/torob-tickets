import { describe, expect, it } from "vitest";

import type { FlightOffer } from "@/domain/flight";
import type {
  LiveProviderAdapter,
  ProviderSearchRequest,
  ProviderSearchResult,
} from "@/modules/providers/contracts/provider";
import { dedupeSameOffer, runWithConcurrency, SearchOrchestrator } from "@/modules/providers/orchestrator";
import { TtlCache } from "@/modules/providers/shared/cache";
import { createMemoryLogger } from "@/modules/providers/shared/logger";
import { assembleLiveOffer, type LiveOfferDraft } from "@/modules/providers/shared/normalize-offer";
import type { FreshnessPolicy } from "@/modules/providers/contracts/provider";

const POLICY: FreshnessPolicy = { freshMs: 60_000, staleMs: 600_000, canClaimAvailability: false, noteFa: "t" };
const NOW = new Date("2026-11-12T10:00:00.000Z");

function draft(overrides: Partial<LiveOfferDraft> = {}): LiveOfferDraft {
  return {
    providerId: "alpha",
    providerName: "آلفا",
    sourceKind: "html",
    endpoint: "GET /search",
    rawRecordId: null,
    sellerLabel: null,
    airlineCode: "IR",
    flightNumber: null,
    originAirport: "THR",
    destinationAirport: "MHD",
    departAt: "2026-11-13T04:00:00.000Z",
    arriveAt: "2026-11-13T05:20:00.000Z",
    durationMinutes: 80,
    segments: [
      {
        airlineCode: "IR",
        flightNumber: null,
        originCode: "THR",
        destinationCode: "MHD",
        departAt: "2026-11-13T04:00:00.000Z",
        arriveAt: "2026-11-13T05:20:00.000Z",
        aircraft: null,
      },
    ],
    price: {
      originalAmount: 5_000_000,
      currency: "IRT",
      currencyScale: 1,
      declaredUnit: "toman",
      toman: 5_000_000,
      converted: false,
    },
    baggage: { checked: "unknown", cabinKg: null, checkedKg: null },
    refundable: null,
    cabin: "economy",
    fareClass: null,
    fareName: null,
    ticketType: "unknown",
    marketingCarrier: null,
    offerUrl: "https://example.com/search",
    providerUpdatedAt: NOW.toISOString(),
    fetchedAt: NOW.toISOString(),
    seatsAvailable: null,
    unitConverted: false,
    ...overrides,
  };
}

function offer(overrides: Partial<LiveOfferDraft> = {}): FlightOffer {
  return assembleLiveOffer(draft(overrides), { freshness: POLICY, now: NOW });
}

/** Minimal adapter whose behaviour each test scripts explicitly. */
function fakeProvider(
  id: string,
  behaviour: {
    records?: unknown[];
    fail?: Error;
    delayMs?: number;
    normalize?: (records: unknown[]) => FlightOffer[];
  },
): LiveProviderAdapter<unknown> & { calls: number } {
  const state = { calls: 0 };
  return {
    id,
    name: id,
    mode: "live" as const,
    sourceKind: "html" as const,
    description: id,
    quotedCurrency: "IRT" as const,
    capabilities: {
      hasFlightNumber: false,
      hasAirportCodes: true,
      hasSegments: false,
      hasFareClass: false,
      hasBaggage: false,
      hasRefundTerms: false,
      hasOfferDeepLink: false,
      hasAvailability: false,
      hasPassengerPrices: false,
    },
    freshness: POLICY,
    complianceNoteFa: "test",
    isConfigured: () => true,
    get calls() {
      return state.calls;
    },
    async search(): Promise<ProviderSearchResult<unknown>> {
      state.calls += 1;
      if (behaviour.delayMs) await new Promise((resolve) => setTimeout(resolve, behaviour.delayMs));
      if (behaviour.fail) throw behaviour.fail;
      const records = behaviour.records ?? [];
      return {
        records,
        meta: {
          providerId: id,
          fetchedAt: NOW.toISOString(),
          latencyMs: 5,
          httpStatus: 200,
          retries: 0,
          fromCache: false,
          endpoint: "GET /search",
          sourceUpdatedAt: null,
        },
        rawCount: records.length,
        warnings: [],
      };
    },
    normalize() {
      return { offers: behaviour.normalize ? behaviour.normalize(behaviour.records ?? []) : [], issues: [] };
    },
  };
}

const QUERY = {
  mode: "flight",
  tripType: "one-way",
  originCode: "THR",
  destinationCode: "MHD",
  departDate: "2026-11-13",
  passengers: 1,
  cabin: "economy",
} as never;

describe("SearchOrchestrator isolation", () => {
  it("keeps a healthy provider's results when another provider throws", async () => {
    const healthy = fakeProvider("alpha", { records: [1], normalize: () => [offer({ providerId: "alpha" })] });
    const broken = fakeProvider("beta", { fail: new Error("socket hang up") });

    const orchestrator = new SearchOrchestrator({
      providers: [healthy, broken],
      logger: createMemoryLogger(),
      now: () => NOW,
      cache: new TtlCache(1_000, 10, () => NOW.getTime()),
    });

    const outcome = await orchestrator.search(QUERY);
    expect(outcome.offers).toHaveLength(1);
    expect(outcome.reports).toHaveLength(2);
    expect(outcome.reports.find((r) => r.providerId === "beta")?.ok).toBe(false);
    expect(outcome.reports.find((r) => r.providerId === "alpha")?.ok).toBe(true);
    expect(outcome.hasLiveOffers).toBe(true);
  });

  it("reports a disabled provider instead of calling it", async () => {
    const provider = fakeProvider("gamma", { records: [] });
    const disabled = { ...provider, isConfigured: () => false };

    const orchestrator = new SearchOrchestrator({ providers: [disabled], logger: createMemoryLogger(), now: () => NOW });
    const outcome = await orchestrator.search(QUERY);

    expect(outcome.reports[0]?.error?.code).toBe("not-configured");
    expect(outcome.reports[0]?.ok).toBe(false);
  });

  it("serves a repeated request from cache and calls the provider once", async () => {
    const provider = fakeProvider("alpha", { records: [1], normalize: () => [offer()] });
    const orchestrator = new SearchOrchestrator({
      providers: [provider],
      logger: createMemoryLogger(),
      now: () => NOW,
      cache: new TtlCache(10_000, 10, () => NOW.getTime()),
    });

    await orchestrator.search(QUERY);
    const second = await orchestrator.search(QUERY);

    expect(provider.calls).toBe(1);
    expect(second.reports[0]?.fromCache).toBe(true);
  });

  it("flags a search with no live offers", async () => {
    const provider = fakeProvider("alpha", { records: [] });
    const orchestrator = new SearchOrchestrator({ providers: [provider], logger: createMemoryLogger(), now: () => NOW });
    const outcome = await orchestrator.search(QUERY);
    expect(outcome.hasLiveOffers).toBe(false);
    expect(outcome.warnings).toContain("no-live-offers");
  });

  it("builds a request with the airports a city query must cover", async () => {
    const orchestrator = new SearchOrchestrator({ providers: [], logger: createMemoryLogger() });
    const domestic = orchestrator.buildRequest(QUERY);
    expect(domestic.originAirports).toEqual(["THR", "PYK", "IKA"]);
    expect(domestic.international).toBe(false);

    const international = orchestrator.buildRequest({ ...(QUERY as Record<string, unknown>), destinationCode: "IST" } as never);
    expect(international.originAirports[0]).toBe("IKA");
    expect(international.international).toBe(true);
  });

  it("caps concurrency", async () => {
    let active = 0;
    let peak = 0;
    const providers = Array.from({ length: 5 }, (_, index) => {
      const provider = fakeProvider(`p${index}`, {});
      return {
        ...provider,
        async search(request: ProviderSearchRequest, ctx: Parameters<LiveProviderAdapter<unknown>["search"]>[1]) {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 10));
          active -= 1;
          return provider.search(request, ctx);
        },
      } as LiveProviderAdapter<unknown>;
    });

    const orchestrator = new SearchOrchestrator({
      providers,
      concurrency: 2,
      logger: createMemoryLogger(),
      now: () => NOW,
    });
    await orchestrator.search(QUERY);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(0);
  });
});

describe("runWithConcurrency", () => {
  it("preserves order regardless of completion order", async () => {
    const result = await runWithConcurrency(
      [10, 5, 1].map((ms) => () => new Promise<number>((resolve) => setTimeout(() => resolve(ms), ms))),
      2,
    );
    expect(result).toEqual([10, 5, 1]);
  });

  it("never exceeds the limit", async () => {
    let active = 0;
    let peak = 0;
    const thunks = Array.from({ length: 7 }, () => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return 1;
    });
    await runWithConcurrency(thunks, 3);
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe("dedupeSameOffer", () => {
  it("keeps the cheapest row for the same product and counts the merge", () => {
    const pricey = offer({ providerId: "alpha", price: { ...draft().price, toman: 5_200_000, originalAmount: 5_200_000 } });
    const cheap = offer({ providerId: "alpha" });

    const warnings: string[] = [];
    const result = dedupeSameOffer([pricey, cheap], warnings);

    expect(result).toHaveLength(1);
    expect(result[0]?.price.toman).toBe(5_000_000);
    expect(result[0]?.provenance?.mergedRows).toBe(2);
    expect(warnings).toContain("duplicate-rows-collapsed");
  });

  it("keeps different fare conditions apart even for the same flight", () => {
    const economy = offer({ providerId: "alpha" });
    const business = offer({ providerId: "alpha", cabin: "business" });
    const withBag = offer({ providerId: "alpha", baggage: { checked: "included", cabinKg: 7, checkedKg: 30 } });

    expect(dedupeSameOffer([economy, business, withBag])).toHaveLength(3);
  });

  it("does not merge identical offers from different providers", () => {
    expect(dedupeSameOffer([offer({ providerId: "alpha" }), offer({ providerId: "beta" })])).toHaveLength(2);
  });
});

describe("orchestrator logging", () => {
  it("never logs credentials", async () => {
    const logger = createMemoryLogger();
    const provider = fakeProvider("alpha", { fail: new Error("auth failed for access_token=SECRET123") });
    const orchestrator = new SearchOrchestrator({ providers: [provider], logger, now: () => NOW });
    await orchestrator.search(QUERY);
    expect(logger.lines.join("\n")).not.toContain("SECRET123");
  });
});
