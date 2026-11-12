import { describe, expect, it } from "vitest";
import { CITIES } from "@/lib/cities";
import {
  availableRoutes,
  destinationsFrom,
  materializePattern,
  patternsForRoute,
  routeCount,
  servedCities,
} from "@/lib/schedules";

const DATE = "2026-11-19";

/**
 * Guard rails for the demo timetable. These assertions are what "wide coverage"
 * actually means: every advertised city can be flown *from* and *to*.
 */
describe("demo timetable coverage", () => {
  it("serves every catalog city in both directions", () => {
    const served = new Set(servedCities());
    expect(served.size).toBe(CITIES.length);

    const stranded = CITIES.filter((city) => destinationsFrom(city.code).length === 0).map((c) => c.code);
    expect(stranded).toEqual([]);

    const noInbound = CITIES.filter(
      (city) => !availableRoutes().some((route) => route.destinationCode === city.code),
    ).map((c) => c.code);
    expect(noInbound).toEqual([]);
  });

  it("keeps the route table free of duplicates", () => {
    const keys = availableRoutes().map((route) => `${route.originCode}-${route.destinationCode}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(routeCount()).toBeGreaterThanOrEqual(100);
  });

  it("materializes a flight for every pattern on a served date", () => {
    for (const route of availableRoutes()) {
      const patterns = patternsForRoute(route.originCode, route.destinationCode, DATE);
      expect(patterns.length).toBeGreaterThan(0);
      for (const pattern of patterns) {
        const flight = materializePattern(pattern, DATE);
        expect(flight.segments.length).toBeGreaterThan(0);
        expect(flight.durationMinutes).toBeGreaterThan(0);
        expect(Date.parse(flight.arriveAtUtc)).toBeGreaterThan(Date.parse(flight.departAtUtc));
      }
    }
  });
});
