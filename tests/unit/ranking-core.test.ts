import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES } from "@/domain/trip";
import { decide, hardConstraintViolations, rankAndDecide, rankInputs } from "@/modules/ranking/core";
import type { RankInput } from "@/modules/ranking/types";

function input(overrides: Partial<RankInput> & { id: string }): RankInput {
  return {
    groupKey: overrides.groupKey ?? "TK|TK873|2026-11-20|THR|IST",
    airlineCode: "TK",
    airlineName: "ترکیش",
    flightNumber: "TK-873",
    originCode: "THR",
    destinationCode: "IST",
    departAt: "2026-11-20T05:10:00.000Z", // 08:40 Tehran
    arriveAt: "2026-11-20T08:15:00.000Z",
    durationMinutes: 185,
    stops: 0,
    segments: [],
    priceToman: 5_000_000,
    cabin: "economy",
    baggage: { checked: "included", checkedKg: 23 },
    refundable: true,
    freshness: "demo",
    completeness: 1,
    priceSource: "demo",
    onTimeScore: null,
    sellerCount: 1,
    ...overrides,
  };
}

const cheapSlow = input({ id: "cheap", priceToman: 3_000_000, durationMinutes: 330, stops: 1 });
const midDirect = input({ id: "mid", priceToman: 3_400_000, durationMinutes: 190, stops: 0 });
const fastPricey = input({ id: "fast", priceToman: 4_600_000, durationMinutes: 150, stops: 0 });
const pool = [cheapSlow, midDirect, fastPricey];

describe("rankInputs determinism", () => {
  it("is identical across runs", () => {
    const a = rankAndDecide(pool, DEFAULT_PREFERENCES);
    const b = rankAndDecide(pool, DEFAULT_PREFERENCES);
    expect(a.ranked.map((r) => r.input.id)).toEqual(b.ranked.map((r) => r.input.id));
    expect(a.ranked.map((r) => r.score)).toEqual(b.ranked.map((r) => r.score));
  });

  it("breaks exact ties on id so the order is stable", () => {
    const twinA = input({ id: "aaa" });
    const twinB = input({ id: "bbb" });
    const result = rankInputs([twinB, twinA], DEFAULT_PREFERENCES);
    expect(result.ranked.map((r) => r.input.id)).toEqual(["aaa", "bbb"]);
  });

  it("respects the stated price preference", () => {
    expect(rankInputs(pool, { ...DEFAULT_PREFERENCES, pricePreference: "low" }).ranked[0]?.input.id).toBe("cheap");
    expect(rankInputs(pool, { ...DEFAULT_PREFERENCES, pricePreference: "comfort" }).ranked[0]?.input.id).toBe("fast");
  });
});

describe("hard constraints", () => {
  it("excludes but never drops violating offers", () => {
    const result = rankInputs(pool, { ...DEFAULT_PREFERENCES, maxStops: 0 });
    expect(result.excluded.map((r) => r.input.id)).toEqual(["cheap"]);
    expect(result.ranked).toHaveLength(3);
    expect(result.ranked[0]?.feasible).toBe(true);
  });

  it("treats unknown baggage as a violation when baggage is required", () => {
    const unknown = input({ id: "u", baggage: { checked: "unknown", checkedKg: null } });
    expect(hardConstraintViolations(unknown, { ...DEFAULT_PREFERENCES, baggageRequired: true })).toContain(
      "وضعیت بار نامشخص است",
    );
  });

  it("enforces a budget", () => {
    const result = rankInputs(pool, { ...DEFAULT_PREFERENCES, maxPriceToman: 3_500_000 });
    expect(result.excluded.map((r) => r.input.id)).toEqual(["fast"]);
  });
});

describe("decide", () => {
  it("assigns best/cheapest/fastest and lets one offer hold several badges", () => {
    const result = rankAndDecide(pool, { ...DEFAULT_PREFERENCES, pricePreference: "low" });
    const byId = Object.fromEntries(result.ranked.map((r) => [r.input.id, r]));

    expect(byId.cheap?.badges).toContain("cheapest");
    expect(byId.fast?.badges).toContain("fastest");
    expect(byId.cheap?.badges).toContain("best"); // the cheap one-stop also wins the blended score
    expect(byId.cheap?.decision).toBe("best"); // primary badge keeps the most specific claim first
    expect(byId.mid?.decision).toBe("alternative");

    // Each badge is awarded at most once across the pool.
    const all = result.ranked.flatMap((r) => r.badges);
    expect(new Set(all).size).toBe(all.length);
  });

  it("gives the same offer both badges when it is both best and cheapest", () => {
    const only = input({ id: "solo" });
    const result = rankAndDecide([only], DEFAULT_PREFERENCES);
    expect(result.ranked[0]?.decision).toBe("best");
  });

  it("still badges the pool when nothing is feasible", () => {
    const result = rankAndDecide(pool, { ...DEFAULT_PREFERENCES, maxPriceToman: 1_000_000 });
    expect(result.feasible).toHaveLength(0);
    expect(result.ranked[0]?.decision).toBe("best");
  });

  it("is idempotent when called twice", () => {
    const result = rankInputs(pool, DEFAULT_PREFERENCES);
    const once = decide(result).map((r) => r.decision);
    const twice = decide(result).map((r) => r.decision);
    expect(twice).toEqual(once);
  });
});

describe("live factors", () => {
  const fresh = input({ id: "fresh", priceToman: 3_400_000, priceSource: "live", freshness: "fresh", sellerCount: 8 });
  const stale = input({ id: "stale", priceToman: 3_400_000, priceSource: "live", freshness: "unverified" });

  it("prefers the fresher price when everything else is equal", () => {
    const result = rankAndDecide([stale, fresh], DEFAULT_PREFERENCES);
    expect(result.ranked[0]?.input.id).toBe("fresh");
  });

  it("keeps demo weights total at 1 when no live offer is present", () => {
    const result = rankInputs(pool, DEFAULT_PREFERENCES);
    const total = Object.values(result.weights).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(result.weights.freshness).toBeUndefined();
  });

  it("keeps weights normalized when live offers introduce new factors", () => {
    const result = rankInputs([fresh, ...pool], DEFAULT_PREFERENCES);
    const total = Object.values(result.weights).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("does not let an unknown-fact offer win on price alone", () => {
    const sparseCheap = input({
      id: "sparse",
      priceToman: 3_100_000,
      priceSource: "live",
      freshness: "unverified",
      completeness: 0.1,
      baggage: { checked: "unknown", checkedKg: null },
      refundable: null,
    });
    const rich = input({
      id: "rich",
      priceToman: 3_150_000,
      priceSource: "live",
      freshness: "fresh",
      completeness: 1,
      sellerCount: 5,
    });
    const result = rankAndDecide([sparseCheap, rich], { ...DEFAULT_PREFERENCES, pricePreference: "balanced" });
    expect(result.ranked[0]?.input.id).toBe("rich");
  });
});
