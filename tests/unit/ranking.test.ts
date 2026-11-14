import { describe, expect, it } from "vitest";
import { deriveWeights, rankOffers, sortScored, hardConstraints } from "@/ranking/score";
import { explainRecommendation } from "@/ranking/explain";
import { DEFAULT_PREFERENCES } from "@/domain/trip";
import type { FlightOffer } from "@/domain/flight";

type OfferOverrides = Partial<FlightOffer> & { priceToman?: number };

function offer(overrides: OfferOverrides): FlightOffer {
  return {
    id: overrides.id ?? "p:1",
    groupKey: overrides.groupKey ?? "TK|TK873|2026-11-20|THR>IST",
    providerId: "p",
    providerName: "نمونه",
    airlineCode: overrides.airlineCode ?? "TK",
    airlineName: "ترکیش",
    flightNumber: "TK-873",
    originCode: "THR",
    destinationCode: "IST",
    departAt: overrides.departAt ?? "2026-11-20T05:10:00.000Z", // 08:40 Tehran
    arriveAt: "2026-11-20T08:15:00.000Z",
    durationMinutes: overrides.durationMinutes ?? 185,
    stops: overrides.stops ?? 0,
    segments: [],
    price: {
      original: { amount: overrides.priceToman ?? 5_000_000, currency: "IRT" },
      toman: overrides.priceToman ?? 5_000_000,
      converted: false,
    },
    baggage: overrides.baggage ?? { checked: "included", cabinKg: 8, checkedKg: 23 },
    refundable: overrides.refundable ?? true,
    cabin: "economy",
    offerUrl: "https://example.com",
    providerUpdatedAt: "2026-11-19T10:00:00.000Z",
    fetchedAt: "2026-11-19T10:00:00.000Z",
    dataSource: "demo",
    warnings: [],
  };
}

const cheapSlow = offer({ id: "cheap", priceToman: 3_000_000, durationMinutes: 330, stops: 1 });
const midDirect = offer({ id: "mid", priceToman: 3_400_000, durationMinutes: 190, stops: 0 });
const fastPricey = offer({ id: "fast", priceToman: 4_600_000, durationMinutes: 150, stops: 0 });
const business = offer({
  id: "biz",
  priceToman: 12_000_000,
  durationMinutes: 400,
  stops: 1,
  baggage: { checked: "included", cabinKg: 7, checkedKg: 35 },
});

const pool = [cheapSlow, midDirect, fastPricey, business];

describe("deterministic ranking", () => {
  it("is stable for identical input", () => {
    const a = rankOffers(pool, DEFAULT_PREFERENCES);
    const b = rankOffers(pool, DEFAULT_PREFERENCES);
    expect(a.ranked.map((s) => s.offer.id)).toEqual(b.ranked.map((s) => s.offer.id));
    expect(a.ranked.map((s) => s.score)).toEqual(b.ranked.map((s) => s.score));
  });

  it("picks the cheapest as cheapest and the shortest as fastest, independently of best", () => {
    const result = rankOffers(pool, { ...DEFAULT_PREFERENCES, pricePreference: "low" });
    expect(result.cheapest?.offer.id).toBe("cheap");
    expect(result.fastest?.offer.id).toBe("fast");
    expect(result.best).not.toBeNull();
  });

  it("prefers the cheap one-stop when the user says 'cheapest'", () => {
    const result = rankOffers(pool, { ...DEFAULT_PREFERENCES, pricePreference: "low" });
    expect(result.best?.offer.id).toBe("cheap");
  });

  it("prefers a direct flight over the cheaper one-stop when the user asks for comfort", () => {
    const result = rankOffers(pool, { ...DEFAULT_PREFERENCES, pricePreference: "comfort" });
    // fast = direct + shortest; cheap = one stop. Comfort care must beat the 33% saving.
    expect(result.best?.offer.id).toBe("fast");
    expect(result.ranked.find((s) => s.offer.id === "mid")!.score).toBeGreaterThan(
      result.ranked.find((s) => s.offer.id === "cheap")!.score,
    );
  });

  it("marks offers violating hard constraints as excluded but keeps them", () => {
    const result = rankOffers(pool, {
      ...DEFAULT_PREFERENCES,
      maxStops: 0,
      baggageRequired: true,
    });
    expect(result.excluded.map((s) => s.offer.id).sort()).toEqual(["biz", "cheap"]);
    expect(result.feasible.map((s) => s.offer.id).sort()).toEqual(["fast", "mid"]);
    expect(result.ranked).toHaveLength(4);
    expect(result.ranked[0]?.feasible).toBe(true);
  });

  it("rejects offers with unknown baggage when baggage is a hard requirement", () => {
    const unknownBaggage = offer({ id: "unknown", baggage: { checked: "unknown", cabinKg: null, checkedKg: null } });
    const result = rankOffers([unknownBaggage, midDirect], { ...DEFAULT_PREFERENCES, baggageRequired: true });
    expect(result.excluded.map((s) => s.offer.id)).toEqual(["unknown"]);
    expect(hardConstraints(unknownBaggage, { ...DEFAULT_PREFERENCES, baggageRequired: true })).toContain(
      "وضعیت بار نامشخص است",
    );
  });

  it("applies the departure-time preference as a hard constraint", () => {
    const evening = offer({ id: "evening", departAt: "2026-11-20T17:00:00.000Z", priceToman: 3_100_000 });
    const result = rankOffers([evening, midDirect], { ...DEFAULT_PREFERENCES, dayPart: "morning" });
    expect(result.excluded.map((s) => s.offer.id)).toEqual(["evening"]);
  });

  it("applies an explicit budget", () => {
    const result = rankOffers(pool, { ...DEFAULT_PREFERENCES, maxPriceToman: 3_500_000 });
    expect(result.cheapest?.offer.id).toBe("cheap");
    expect(result.excluded.map((s) => s.offer.id).sort()).toEqual(["biz", "fast"]);
  });

  it("renormalizes weights so intent changes the weighting but not the scale", () => {
    const balanced = deriveWeights(DEFAULT_PREFERENCES);
    const low = deriveWeights({ ...DEFAULT_PREFERENCES, pricePreference: "low" });
    for (const weights of [balanced, low]) {
      const total = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 5);
    }
    expect(low.price).toBeGreaterThan(balanced.price);
  });

  it("sorts by each explicit key", () => {
    const result = rankOffers(pool, DEFAULT_PREFERENCES);
    expect(sortScored(result.ranked, "cheapest").map((s) => s.offer.id)).toEqual(["cheap", "mid", "fast", "biz"]);
    expect(sortScored(result.ranked, "fastest").map((s) => s.offer.id)).toEqual(["fast", "mid", "cheap", "biz"]);
  });

  it("produces a Persian explanation grounded only in the offer's own facts", () => {
    const result = rankOffers(pool, DEFAULT_PREFERENCES);
    const text = explainRecommendation(result.best!.offer, result);
    expect(text).toContain("بهترین تطابق");
    expect(text).toMatch(/[\u06F0-\u06F9]/); // Persian digits
    // The explanation must mention the recommended airline, and never the business fare.
    expect(text).toContain(result.best!.offer.airlineName);
    expect(text).not.toContain("امارات");
  });

  it("returns an empty, non-throwing result for an empty pool", () => {
    const result = rankOffers([], DEFAULT_PREFERENCES);
    expect(result.best).toBeNull();
    expect(result.ranked).toEqual([]);
  });
});
