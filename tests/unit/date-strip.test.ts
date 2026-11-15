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
import {
  clampIntoWindow,
  DATE_STRIP_DAYS,
  defaultStripStart,
  getDayPrices,
  isValidStripStart,
  nextStripStart,
  previousStripStart,
  resolveStripStart,
  stripDates,
  stripRangeLabel,
  STRIP_LEAD_DAYS,
} from "@/server/day-prices";

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

/**
 * §11: the strip is a window that slides. The bug it fixes — tapping a later day jumped that day
 * to the first chip and hid the days before it — is pinned here, without a browser.
 */
describe("the sliding day window", () => {
  const today = "2026-11-13";

  it("gives the selected day context instead of making it the first chip", () => {
    const start = defaultStripStart("2026-11-20", today);
    expect(start).toBe(addDays("2026-11-20", -STRIP_LEAD_DAYS));
    const dates = stripDates(start, DATE_STRIP_DAYS);
    expect(dates).toContain("2026-11-20");
    expect(dates.indexOf("2026-11-20")).toBe(STRIP_LEAD_DAYS);
    // Days before the selection are in the window, i.e. still visible.
    expect(dates[0]! < "2026-11-20").toBe(true);
  });

  it("never starts before today, and still shows a selection made before today", () => {
    const start = defaultStripStart("2026-11-01", today);
    expect(start).toBe(today);
    const dates = stripDates(start, DATE_STRIP_DAYS);
    expect(dates[0]).toBe(today);
  });

  it("keeps a requested window when it contains the selection, rejects one that does not", () => {
    expect(isValidStripStart("2026-11-18", "2026-11-20", today)).toBe(true);
    // A window that would hide the selected day, or reach into the past, is not used.
    expect(isValidStripStart("2026-11-24", "2026-11-20", today)).toBe(false);
    expect(isValidStripStart("2026-11-01", "2026-11-20", today)).toBe(false);
    expect(isValidStripStart("not-a-date", "2026-11-20", today)).toBe(false);
    expect(resolveStripStart("2026-11-18", "2026-11-20", today)).toBe("2026-11-18");
    expect(resolveStripStart("2026-11-24", "2026-11-20", today)).toBe(defaultStripStart("2026-11-20", today));
    expect(resolveStripStart(null, "2026-11-20", today)).toBe(defaultStripStart("2026-11-20", today));
  });

  it("moves exactly one window per press, and stops at today going back", () => {
    expect(previousStripStart(today, today)).toBeNull();
    // A full window back when there is room…
    expect(previousStripStart("2026-11-29", today)).toBe("2026-11-21");
    // …and no gap when there is not: a slid window can always return to today.
    expect(previousStripStart("2026-11-18", today)).toBe(today);
    expect(nextStripStart("2026-11-18", today)).toBe("2026-11-26");
    expect(nextStripStart(today, today)).toBe(addDays(today, DATE_STRIP_DAYS));
  });

  it("labels the window and collapses the month when both ends share it", () => {
    expect(stripRangeLabel("2026-11-13", DATE_STRIP_DAYS)).toBe("۲۲ تا ۲۹ آبان");
    expect(stripRangeLabel("2026-11-18", DATE_STRIP_DAYS)).toBe("۲۷ آبان تا ۴ آذر");
  });

  it("stops sliding past the horizon instead of offering an empty page", () => {
    const far = addDays(today, 90);
    expect(nextStripStart(far, today)).toBeNull();
  });

  it("keeps a chip selected after paging, by clamping the day into the new window", () => {
    // The selection is inside the new window: it stays selected.
    expect(clampIntoWindow("2026-11-26", DATE_STRIP_DAYS, "2026-11-28", today)).toBe("2026-11-28");
    expect(clampIntoWindow("2026-11-13", DATE_STRIP_DAYS, "2026-11-20", today)).toBe("2026-11-20");
    // The selection falls outside it: the nearest end is selected instead of nothing.
    expect(clampIntoWindow("2026-11-26", DATE_STRIP_DAYS, "2026-11-20", today)).toBe("2026-11-26");
    // The window never opens in the past, so its first day is floored at today.
    expect(clampIntoWindow("2026-11-10", DATE_STRIP_DAYS, "2026-11-01", today)).toBe(today);
  });
});
