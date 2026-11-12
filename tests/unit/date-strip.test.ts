import { describe, expect, it } from "vitest";

import { createQuery } from "@/domain/trip";
import {
  addDays,
  formatJalali,
  isoToJalali,
  isoToday,
  jalaliMonthLength,
  jalaliToIso,
} from "@/lib/jalali";
import { DATE_STRIP_DAYS, getDayPrices } from "@/server/day-prices";

/**
 * §7: the eight-day strip is "today … today+7", and its Jalali labels are correct across the
 * Esfand/Farvardin boundary (the B10/B11 family of bugs lived here).
 */

const query = createQuery({ originCode: "IFN", destinationCode: "KIH", departDate: "2026-11-20" });

describe("the eight-day strip", () => {
  it("is exactly eight consecutive days starting at the given day", async () => {
    const prices = await getDayPrices(query, { from: "2026-11-20", days: DATE_STRIP_DAYS, now: new Date("2026-11-01T08:00:00Z") });
    expect(prices).toHaveLength(8);
    prices.forEach((day, index) => {
      expect(day.date).toBe(addDays("2026-11-20", index));
    });
  });

  it("defaults to today … today+7", async () => {
    const now = new Date("2026-11-12T09:00:00Z");
    const prices = await getDayPrices(query, { now });
    expect(prices.map((day) => day.date)).toEqual(
      Array.from({ length: DATE_STRIP_DAYS }, (_, index) => addDays(isoToday(now), index)),
    );
    expect(prices[0]?.isToday).toBe(true);
    expect(prices.slice(1).every((day) => !day.isToday)).toBe(true);
  });

  it("labels the days in Jalali and crosses Esfand→Farvardin without skipping or repeating", () => {
    // 1405 is a common year, so Esfand has 29 days; the strip starts three days before Nowruz.
    const esfand29 = jalaliToIso(1405, 12, 29);
    const days = Array.from({ length: DATE_STRIP_DAYS }, (_, index) => addDays(esfand29, index));

    expect(isoToJalali(days[0]!)).toEqual({ year: 1405, month: 12, day: 29 });
    expect(isoToJalali(days[1]!)).toEqual({ year: 1406, month: 1, day: 1 });
    expect(jalaliMonthLength(1405, 12)).toBe(29);

    // Every label is a distinct, parseable Jalali date, and the months are exactly the two
    // that the boundary spans.
    const labels = days.map((day) => formatJalali(day, "short"));
    expect(new Set(labels).size).toBe(days.length);
    expect(labels[0]).toBe("۲۹ اسفند");
    expect(labels[1]).toBe("۱ فروردین");
    for (const label of labels) expect(label).toMatch(/^[۰-۹]+ (اسفند|فروردین)$/);

    // And the Gregorian side is ordinary: no day is skipped (Nowruz 1406 = 21 March 2027).
    expect(days[1]).toBe("2027-03-21");
  });

  it("returns a chip for every day even when a day has no flights", async () => {
    const prices = await getDayPrices(query, {
      from: "2026-11-20",
      days: 4,
      now: new Date("2026-11-01T08:00:00Z"),
    });
    expect(prices).toHaveLength(4);
    for (const day of prices) {
      expect(day.label).toMatch(/[۰-۹]+ (آبان|آذر) [۰-۹]+/);
      expect(day.cheapestToman === null || day.cheapestToman > 0).toBe(true);
    }
  });
});
