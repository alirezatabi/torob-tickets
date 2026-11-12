import { describe, expect, it } from "vitest";

import { createQuery } from "@/domain/trip";
import { groupOffers } from "@/dedupe/group";
import { buildFlightResults, sortFlights, type FlightResult, type FlightSortKey } from "@/modules/search/results";
import { runSearch } from "@/providers/search";

/**
 * §7: each of the four tabs orders the *same* list differently, deterministically, and a
 * sold-out flight stays last on all four.
 */

const NOW = new Date("2026-11-01T08:00:00Z");
const SORTS: FlightSortKey[] = ["cheapest", "best", "fastest", "earliest"];

async function results(passengers = 1): Promise<FlightResult[]> {
  const query = createQuery({ originCode: "IFN", destinationCode: "KIH", departDate: "2026-11-20" });
  const outcome = await runSearch({ ...query, passengers }, { now: NOW });
  return buildFlightResults(groupOffers(outcome.offers), { ...query, passengers }, {
    passengers,
    cabin: query.cabin,
    sort: "cheapest",
  }).flights;
}

const keys = (flights: FlightResult[]) => flights.map((flight) => flight.group.groupKey);

describe("the four sort tabs", () => {
  it("each produces a stable order for the same input", async () => {
    const flights = await results();
    for (const sort of SORTS) {
      expect(keys(sortFlights(flights, sort))).toEqual(keys(sortFlights(flights, sort)));
    }
  });

  it("orders the same flights and never drops one", async () => {
    const flights = await results();
    const expected = [...keys(flights)].sort();
    for (const sort of SORTS) {
      expect([...keys(sortFlights(flights, sort))].sort()).toEqual(expected);
    }
  });

  it("gives cheapest a non-decreasing price order", async () => {
    const flights = await results();
    const prices = sortFlights(flights, "cheapest").map((flight) => flight.selection.cheapest?.price.toman ?? Infinity);
    for (let i = 1; i < prices.length; i += 1) expect(prices[i]!).toBeGreaterThanOrEqual(prices[i - 1]!);
  });

  it("gives fastest a non-decreasing duration order", async () => {
    const flights = await results();
    const durations = sortFlights(flights, "fastest").map((flight) => flight.display.durationMinutes);
    for (let i = 1; i < durations.length; i += 1) expect(durations[i]!).toBeGreaterThanOrEqual(durations[i - 1]!);
  });

  it("gives earliest a non-decreasing departure order", async () => {
    const flights = await results();
    const departures = sortFlights(flights, "earliest").map((flight) => new Date(flight.display.departAt).getTime());
    for (let i = 1; i < departures.length; i += 1) expect(departures[i]!).toBeGreaterThanOrEqual(departures[i - 1]!);
  });

  it("makes cheapest and earliest disagree on this route (the tab is not cosmetic)", async () => {
    const flights = await results();
    expect(keys(sortFlights(flights, "cheapest"))).not.toEqual(keys(sortFlights(flights, "earliest")));
  });

  it("keeps sold-out flights last under all four tabs", async () => {
    const flights = await results(9);
    const soldOut = flights.filter((flight) => flight.soldOut);
    for (const sort of SORTS) {
      const ordered = sortFlights(flights, sort);
      if (soldOut.length === 0) {
        expect(ordered.every((flight) => !flight.soldOut)).toBe(true);
        continue;
      }
      expect(ordered.slice(ordered.length - soldOut.length).every((flight) => flight.soldOut)).toBe(true);
      expect(ordered.slice(0, ordered.length - soldOut.length).every((flight) => !flight.soldOut)).toBe(true);
    }
  });
});
