import { describe, expect, it } from "vitest";
import { CITIES } from "@/lib/cities";
import {
  availableRoutes,
  destinationsFrom,
  FLIGHT_PATTERNS,
  materializePattern,
  patternsForRoute,
  routeCount,
  servedCities,
} from "@/lib/schedules";

const DATE = "2026-11-19";

/** Nearest date on/after `fromIso` that falls on the given weekday (0 = Sunday). */
function dateWithWeekday(fromIso: string, weekday: number): string {
  const date = new Date(`${fromIso}T00:00:00Z`);
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = new Date(date.getTime() + offset * 86_400_000);
    if (candidate.getUTCDay() === weekday) return candidate.toISOString().slice(0, 10);
  }
  return fromIso;
}

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

  it("provides a dense, deterministic schedule with unique flight numbers throughout the day", () => {
    expect(FLIGHT_PATTERNS.length).toBeGreaterThan(1_000);
    const date = "2026-11-20";
    const first = patternsForRoute("IFN", "KIH", date);
    const second = patternsForRoute("IFN", "KIH", date);
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(first.map((pattern) => pattern.id)).toEqual(second.map((pattern) => pattern.id));
    expect(new Set(first.map((pattern) => pattern.flightNumber)).size).toBe(first.length);
    expect(Math.max(...first.map((pattern) => pattern.departMinutes)) - Math.min(...first.map((pattern) => pattern.departMinutes))).toBeGreaterThan(18 * 60);
  });

  it("materializes every pattern on a day it actually operates", () => {
    // Some routes are not daily, so a single test date is not enough: pick a date
    // inside each pattern's own operating weekdays.
    for (const pattern of FLIGHT_PATTERNS) {
      const weekday = pattern.days[0] ?? 0;
      const date = dateWithWeekday(DATE, weekday);
      const patterns = patternsForRoute(pattern.originCode, pattern.destinationCode, date);
      expect(patterns.length).toBeGreaterThan(0);

      const flight = materializePattern(pattern, date);
      expect(flight.segments.length).toBeGreaterThan(0);
      expect(flight.durationMinutes).toBeGreaterThan(0);
      expect(Date.parse(flight.arriveAtUtc)).toBeGreaterThan(Date.parse(flight.departAtUtc));
    }
  });
});
