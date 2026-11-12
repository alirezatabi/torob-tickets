import { describe, expect, it } from "vitest";

import {
  assembleLiveOffer,
  baggageFacts,
  computeFreshness,
  type LiveOfferDraft,
} from "@/modules/providers/shared/normalize-offer";
import type { FreshnessPolicy } from "@/modules/providers/contracts/provider";

const POLICY: FreshnessPolicy = {
  freshMs: 5 * 60_000,
  staleMs: 20 * 60_000,
  canClaimAvailability: false,
  noteFa: "test",
};

const NOW = new Date("2026-11-12T10:00:00.000Z");

function draft(overrides: Partial<LiveOfferDraft> = {}): LiveOfferDraft {
  return {
    providerId: "sepehr360",
    providerName: "سپهر۳۶۰",
    sourceKind: "html",
    endpoint: "GET /Flight/B2c/Search",
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
      originalAmount: 5_902_000,
      currency: "IRT",
      currencyScale: 1,
      declaredUnit: "toman",
      toman: 5_902_000,
      converted: false,
    },
    baggage: { checked: "unknown", cabinKg: null, checkedKg: null },
    refundable: null,
    cabin: "economy",
    fareClass: null,
    fareName: null,
    ticketType: "unknown",
    marketingCarrier: null,
    offerUrl: "https://sepehr360.ir/Flight/B2c/Search?origin=THR&destination=MHD&departureDate=1405-08-22",
    providerUpdatedAt: "2026-11-12T09:58:00.000Z",
    fetchedAt: NOW.toISOString(),
    seatsAvailable: null,
    unitConverted: false,
    ...overrides,
  };
}

describe("assembleLiveOffer", () => {
  it("maps a sparse aggregator row without inventing facts", () => {
    const offer = assembleLiveOffer(draft(), { freshness: POLICY, now: NOW });

    expect(offer.id.startsWith("sepehr360:")).toBe(true);
    expect(offer.originCode).toBe("THR");
    expect(offer.destinationCode).toBe("MHD");
    expect(offer.originAirport).toBe("THR");
    expect(offer.flightNumber).toBeNull();
    expect(offer.baggage.checked).toBe("unknown");
    expect(offer.refundable).toBeNull();
    expect(offer.price.toman).toBe(5_902_000);
    expect(offer.dataSource).toBe("live");
    expect(offer.freshness).toBe("fresh");
    expect(offer.stops).toBe(0);
    expect(offer.warnings).toContain("flight-number-missing");
    expect(offer.warnings).toContain("baggage-unknown");
    expect(offer.warnings).toContain("availability-unverified");
  });

  it("produces the same id for the same product across two fetches", () => {
    const a = assembleLiveOffer(draft(), { freshness: POLICY, now: NOW });
    const b = assembleLiveOffer(draft({ fetchedAt: "2026-11-12T10:02:00.000Z" }), {
      freshness: POLICY,
      now: new Date("2026-11-12T10:02:00.000Z"),
    });
    expect(a.id).toBe(b.id);
  });

  it("produces different ids for different fare conditions", () => {
    const withBag = assembleLiveOffer(
      draft({ baggage: { checked: "included", cabinKg: 7, checkedKg: 30 }, refundable: true, fareClass: "Y" }),
      { freshness: POLICY, now: NOW },
    );
    const noBag = assembleLiveOffer(draft({ baggage: { checked: "not-included", cabinKg: 7, checkedKg: 0 } }), {
      freshness: POLICY,
      now: NOW,
    });
    expect(withBag.id).not.toBe(noBag.id);
  });

  it("keeps a rial price converted exactly once and flags it", () => {
    const offer = assembleLiveOffer(
      draft({
        price: {
          originalAmount: 18_108_700,
          currency: "IRR",
          currencyScale: 1,
          declaredUnit: "rial",
          toman: 1_810_870,
          converted: true,
        },
        unitConverted: true,
      }),
      { freshness: POLICY, now: NOW },
    );
    expect(offer.price.toman).toBe(1_810_870);
    expect(offer.price.converted).toBe(true);
    expect(offer.warnings).toContain("price-converted");
    expect(offer.provenance?.unitConverted).toBe(true);
  });

  it("derives duration only when the source omits it, and labels it", () => {
    const offer = assembleLiveOffer(draft({ durationMinutes: null }), { freshness: POLICY, now: NOW });
    expect(offer.durationMinutes).toBe(80);
    expect(offer.warnings).toContain("duration-inferred");
  });

  it("carries a stated stop count without inventing segments", () => {
    const offer = assembleLiveOffer(draft({ stopsOverride: 1 }), { freshness: POLICY, now: NOW });
    expect(offer.stops).toBe(1);
    expect(offer.segments).toHaveLength(1);
    expect(offer.warnings).toContain("stops-partial");
  });

  it("rejects an unrepresentable record instead of fixing it", () => {
    expect(() => assembleLiveOffer(draft({ price: { ...draft().price, toman: 0 } }), { freshness: POLICY, now: NOW })).toThrow();
    expect(() =>
      assembleLiveOffer(draft({ originAirport: "ZZZ" }), { freshness: POLICY, now: NOW }),
    ).toThrow();
    expect(() =>
      assembleLiveOffer(draft({ arriveAt: "2026-11-13T03:00:00.000Z", durationMinutes: null }), {
        freshness: POLICY,
        now: NOW,
      }),
    ).toThrow();
  });

  it("computes completeness from what the source actually provided", () => {
    const sparse = assembleLiveOffer(draft(), { freshness: POLICY, now: NOW });
    const rich = assembleLiveOffer(
      draft({
        flightNumber: "IR-452",
        baggage: { checked: "included", cabinKg: 7, checkedKg: 30 },
        refundable: false,
        fareClass: "Y",
        segments: [
          {
            airlineCode: "IR",
            flightNumber: "IR-452",
            originCode: "THR",
            destinationCode: "MHD",
            departAt: "2026-11-13T04:00:00.000Z",
            arriveAt: "2026-11-13T05:20:00.000Z",
            aircraft: "A320",
          },
          {
            airlineCode: "IR",
            flightNumber: "IR-453",
            originCode: "MHD",
            destinationCode: "MHD",
            departAt: "2026-11-13T05:20:00.000Z",
            arriveAt: "2026-11-13T05:20:00.000Z",
            aircraft: null,
          },
        ],
      }),
      { freshness: POLICY, now: NOW },
    );
    expect(rich.completeness ?? 0).toBeGreaterThan(sparse.completeness ?? 1);
  });
});

describe("computeFreshness", () => {
  it("maps observation age to honest states", () => {
    const observed = (minutesAgo: number) =>
      new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

    expect(computeFreshness(observed(1), NOW, POLICY)).toBe("fresh");
    expect(computeFreshness(observed(10), NOW, POLICY)).toBe("possibly-stale");
    expect(computeFreshness(observed(45), NOW, POLICY)).toBe("unverified");
  });

  it("treats a future timestamp as unverified rather than fresh", () => {
    expect(computeFreshness(new Date(NOW.getTime() + 60_000).toISOString(), NOW, POLICY)).toBe("unverified");
  });
});

describe("baggageFacts", () => {
  it("distinguishes unknown from not-included", () => {
    expect(baggageFacts({ checked: "unknown", cabinKg: null, checkedKg: null })).toEqual(["checked-unknown"]);
    expect(baggageFacts({ checked: "not-included", cabinKg: null, checkedKg: 0 })).toEqual(["checked-none"]);
    expect(baggageFacts({ checked: "included", cabinKg: 7, checkedKg: 30 })).toEqual(["checked-30kg", "cabin-7kg"]);
  });
});
