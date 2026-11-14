import { describe, expect, it } from "vitest";
import { createQuery } from "@/domain/trip";
import { addDays, isoToday } from "@/lib/jalali";
import { groupOffers } from "@/dedupe/group";
import { runSearch } from "@/providers/search";
import { buildFlightResults, sortFlights, type FlightResult } from "@/modules/search/results";
import { getDayPrices, DATE_STRIP_DAYS, cheapestDay } from "@/server/day-prices";
import type { SearchOutcome } from "@/providers/search";

/**
 * Phase B of prompt 02: the pipeline ranks **flights**, the four tabs really differ, a sold
 * out flight is last, and the eight-day strip is built from the same pricing rule.
 */

const query = createQuery({ originCode: "IFN", destinationCode: "KIH", departDate: "2026-11-20" });
const NOW = new Date("2026-11-01T08:00:00Z");

async function pipeline(sort: "best" | "cheapest" | "earliest" | "fastest" = "cheapest", passengers = 1) {
  const outcome = await runSearch({ ...query, passengers }, { now: NOW });
  const groups = groupOffers(outcome.offers);
  return buildFlightResults(groups, { ...query, passengers }, { passengers, cabin: query.cabin, sort });
}

describe("flight-level pipeline", () => {
  it("returns one result per physical flight, priced at its cheapest purchasable seller", async () => {
    const results = await pipeline("cheapest");
    expect(results.flights.length).toBeGreaterThanOrEqual(8);
    for (const flight of results.flights) {
      expect(flight.group.providers.length).toBeGreaterThanOrEqual(3);
      expect(flight.selection.cheapest).not.toBeNull();
      expect(flight.display.groupKey).toBe(flight.group.groupKey);
      // The displayed price is the selection's, never the group's raw primary.
      expect(flight.display.price.toman).toBe(flight.selection.cheapest?.price.toman);
    }
  });

  it("gives the ranking the flight's real seller count, not 1", async () => {
    const results = await pipeline("cheapest");
    for (const entry of results.ranked.ranked) {
      expect(entry.input.sellerCount).toBeGreaterThanOrEqual(3);
    }
  });

  it("produces four different, stable orders", async () => {
    const cheapest = await pipeline("cheapest");
    const fastest = await pipeline("fastest");
    const earliest = await pipeline("earliest");
    const best = await pipeline("best");

    const keys = (results: { flights: FlightResult[] }) => results.flights.map((flight) => flight.group.groupKey).join("|");
    expect(keys(cheapest)).toBe(keys(cheapest)); // deterministic
    // Cheapest and earliest cannot both be first here: the 19:00 flight is cheaper.
    expect(cheapest.flights[0]?.group.groupKey).not.toBe(earliest.flights[0]?.group.groupKey);
    expect(keys(fastest)).not.toBe(keys(earliest));
    expect(keys(best)).not.toBe("");
  });

  it("puts a sold out flight last and keeps it visible", async () => {
    const results = await pipeline("cheapest", 9);
    const soldOut = results.flights.filter((flight) => flight.soldOut);
    if (soldOut.length === 0) return; // seats for 9 passengers are not guaranteed on every date
    const last = results.flights[results.flights.length - 1];
    expect(last?.soldOut).toBe(true);
    expect(results.flights.slice(0, -soldOut.length).every((flight) => !flight.soldOut)).toBe(true);
  });

  it("lists every seller with its delta from the cheapest, and the excluded ones", async () => {
    const results = await pipeline("cheapest");
    for (const flight of results.flights) {
      expect(flight.sellers.length).toBe(flight.group.providers.length + (flight.sellers.length - flight.group.providers.length));
      const cheapest = flight.sellers.find((seller) => seller.cheapest);
      expect(cheapest?.deltaToman).toBe(0);
      expect(flight.sellers.filter((seller) => !seller.cheapest).every((seller) => seller.deltaToman >= 0)).toBe(true);
    }
  });

  it("sorts a sold-out flight after an available one regardless of price", () => {
    const base = { score: 0, feasible: true, violations: [], sellers: [], ineligible: [] } as unknown as FlightResult;
    const soldOut = { ...base, soldOut: true } as FlightResult;
    const available = { ...base, soldOut: false } as FlightResult;
    expect(sortFlights([soldOut, available], "cheapest")[0]).toBe(available);
    expect(sortFlights([soldOut, available], "best")[1]).toBe(soldOut);
  });
});

describe("getDayPrices (the 8-day strip)", () => {
  it("returns exactly eight days, today first, each with its own cheapest price", async () => {
    const prices = await getDayPrices(query, { from: "2026-11-20", days: DATE_STRIP_DAYS, now: NOW });
    expect(prices).toHaveLength(8);
    expect(prices[0]?.date).toBe("2026-11-20");
    expect(prices[7]?.date).toBe("2026-11-27");
    expect(DATE_STRIP_DAYS).toBe(8);
    for (const day of prices) {
      expect(day.state).toBe("ok");
      expect(day.cheapestToman).toBeGreaterThan(0);
      // Jalali label, e.g. «جمعه ۲۹ آبان ۱۴۰۵» (the strip may cross into آذر).
      expect(day.label).toMatch(/[۰-۹]+ (آبان|آذر) [۰-۹]+/);
    }
  });

  it("agrees with the list: the chip price is the cheapest flight of that day", async () => {
    const prices = await getDayPrices(query, { from: "2026-11-20", days: 1, now: NOW });
    const results = await pipeline("cheapest");
    expect(prices[0]?.cheapestToman).toBe(
      Math.min(...results.flights.filter((f) => !f.soldOut).map((f) => f.selection.cheapest?.price.toman ?? Infinity)),
    );
  });

  it("says «no price» for a day without flights, never zero", async () => {
    const search = (async () =>
      ({ query, offers: [], ranked: { ranked: [], feasible: [], excluded: [], cheapest: null, fastest: null, best: null, weights: {} }, health: [], issues: [], fetchedAt: NOW.toISOString(), totalMs: 0 }) as unknown as SearchOutcome) as typeof runSearch;
    const prices = await getDayPrices(query, { from: "2026-11-20", days: 2, now: NOW, search });
    expect(prices.map((day) => day.cheapestToman)).toEqual([null, null]);
    expect(prices.map((day) => day.state)).toEqual(["empty", "empty"]);
  });

  it("breaks only the failing day's chip, not the strip", async () => {
    let call = 0;
    const search = (async (q: Parameters<typeof runSearch>[0]) => {
      call += 1;
      if (call === 2) throw new Error("provider exploded");
      return runSearch(q, { now: NOW });
    }) as typeof runSearch;
    const prices = await getDayPrices(query, { from: "2026-11-20", days: 3, now: NOW, search });
    expect(prices).toHaveLength(3);
    expect(prices[1]?.state).toBe("error");
    expect(prices[1]?.cheapestToman).toBeNull();
    expect(prices[0]?.state).toBe("ok");
    expect(prices[2]?.state).toBe("ok");
  });

  it("marks a past day as empty instead of searching it", async () => {
    // NOW is 10 Aban 1405, so 23 Mehr (2026-10-15) is history and must not be searched.
    const today = isoToday(new Date("2026-11-01T08:00:00Z"));
    const yesterday = addDays(today, -1);
    const prices = await getDayPrices(query, { from: yesterday, days: 2, now: new Date("2026-11-01T08:00:00Z") });
    expect(prices[0]?.cheapestToman).toBeNull();
    expect(prices[0]?.state).toBe("empty");
    // The second day is today (10 Aban) and does have flights.
    expect(prices[1]?.date).toBe(today);
    expect(prices[1]?.cheapestToman).toBeGreaterThan(0);
  });

  it("can name the cheapest day of the strip", async () => {
    const prices = await getDayPrices(query, { from: "2026-11-20", days: 8, now: NOW });
    const cheapest = cheapestDay(prices);
    expect(cheapest).not.toBeNull();
    const minimum = Math.min(...prices.map((day) => day.cheapestToman ?? Infinity));
    expect(cheapest?.cheapestToman).toBe(minimum);
  });
});
