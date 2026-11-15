import type { TripQuery } from "@/domain/trip";
import { groupOffers } from "@/dedupe/group";
import { runSearch } from "@/providers/search";
import { selectCheapestOffer } from "@/modules/pricing/select-cheapest";
import { addDays, diffDays, formatJalali, formatJalaliFull, isValidCivilDate, isoToday } from "@/lib/jalali";

/**
 * The 8-day date strip: "which day should I fly?" answered with the cheapest price of each
 * day for **this route and this passenger count**.
 *
 * Rules that matter:
 *   • every chip price comes from `selectCheapestOffer` (the same rule as the cards below), so
 *     a chip can never contradict the list;
 *   • a day with no flight — or with nothing purchasable — is `cheapestToman: null`, rendered
 *     as «—», never as `۰`;
 *   • a day that throws only poisons its own chip (`state: "error"`), never the strip;
 *   • the clock is injectable, so "today" and the sales cutoff are testable.
 */

/** How many days the strip shows, today included. */
export const DATE_STRIP_DAYS = 8;

/**
 * The strip is a **window that can slide**, and its position is state — not a side effect of
 * which chip was tapped.
 *
 * The bug this replaces: the window always *began* at the selected day, so tapping the 5th chip
 * sent it to the top of the strip and every earlier day disappeared, even future ones. Now:
 *   • the window start travels in the URL as `strip=` and the chips carry it, so tapping a day
 *     inside the window leaves the whole strip exactly where it was;
 *   • a window without that state is derived from the selection with `STRIP_LEAD_DAYS` of
 *     context before it (never before today), so the selected day is never the first chip;
 *   • «قبلی»/«بعدی» move the window by exactly one window and always keep the selection inside.
 * All of it is pure, so the paging is testable without a browser.
 */

/** Days of context shown *before* the selected day when the window has no saved position. */
export const STRIP_LEAD_DAYS = 2;

/** How far ahead the strip may slide — a little under a season. */
export const STRIP_MAX_DAYS_AHEAD = 90;

/** The first day of the window. Today is the floor: a past day cannot be bought. */
export function defaultStripStart(selectedDate: string, today: string): string {
  // A past day is not shown at all: the window starts at today, where buying starts.
  if (selectedDate < today) return today;
  const lead = addDays(selectedDate, -STRIP_LEAD_DAYS);
  return lead < today ? today : lead;
}

/** Is `start` a usable window for `selectedDate` (inside it, and not in the past)? */
export function isValidStripStart(
  start: string,
  selectedDate: string,
  today: string,
  days: number = DATE_STRIP_DAYS,
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !isValidCivilDate(start)) return false;
  if (start < today) return false;
  return selectedDate >= start && selectedDate <= addDays(start, Math.max(1, days) - 1);
}

/** The window start to use: the requested one when it is usable, else derived from the selection. */
export function resolveStripStart(
  requested: string | null | undefined,
  selectedDate: string,
  today: string,
  days: number = DATE_STRIP_DAYS,
): string {
  if (requested && isValidStripStart(requested, selectedDate, today, days)) return requested;
  return defaultStripStart(selectedDate, today);
}

/**
 * The day to select inside a window: the selection itself when it is in the window, otherwise the
 * nearest end. Paging therefore never lands on a window whose highlighted chip is missing.
 */
export function clampIntoWindow(start: string, days: number, selectedDate: string, today: string): string {
  const first = start < today ? today : start;
  const last = addDays(start, Math.max(1, days) - 1);
  if (selectedDate < first) return first;
  return selectedDate > last ? last : selectedDate;
}

/** The window's `days` dates. */
export function stripDates(start: string, days: number): string[] {
  return Array.from({ length: Math.max(1, days) }, (_, index) => addDays(start, index));
}

/** «قبلی» — one window back. `null` at today, where there is nothing earlier to sell. */
export function previousStripStart(start: string, today: string, days: number = DATE_STRIP_DAYS): string | null {
  const back = addDays(start, -Math.max(1, days));
  if (back >= today) return back;
  // Never leave a gap: a window that has slid forward can still walk back to today, even when
  // that is less than a full window. Only the window that already starts at today has no «قبلی».
  return start > today ? today : null;
}

/** «بعدی» — one window forward, up to `STRIP_MAX_DAYS_AHEAD`. `null` past that horizon. */
export function nextStripStart(start: string, today: string, days: number = DATE_STRIP_DAYS): string | null {
  const next = addDays(start, Math.max(1, days));
  return diffDays(today, next) > STRIP_MAX_DAYS_AHEAD ? null : next;
}

/** Human label for the window, e.g. «۲۲ تا ۲۹ آبان» or «۲۹ آبان تا ۶ آذر». */
export function stripRangeLabel(start: string, days: number = DATE_STRIP_DAYS): string {
  const dates = stripDates(start, days);
  const first = formatJalali(dates[0]!, "short");
  const last = formatJalali(dates[dates.length - 1]!, "short");
  const [firstDay, firstMonth] = first.split(" ");
  const [, lastMonth] = last.split(" ");
  return firstMonth === lastMonth ? `${firstDay} تا ${last}` : `${first} تا ${last}`;
}

export type DayPriceState = "ok" | "empty" | "error";

export interface DayPrice {
  /** `YYYY-MM-DD` */
  date: string;
  /** Jalali label for screen readers and the chip tooltip. */
  label: string;
  cheapestToman: number | null;
  /** How many physical flights that day has (0 when empty). */
  flightsCount: number;
  /** How many flights are sold out for the requested passenger count. */
  soldOutCount: number;
  /** Carrier of the day's cheapest fare — `null` when the day has no purchasable fare. */
  airlineCode: string | null;
  /** Shortest block time among that day's flights, in minutes. */
  fastestMinutes: number | null;
  state: DayPriceState;
  isToday: boolean;
}

export interface DayPricesOptions {
  from?: string;
  days?: number;
  now?: Date;
  /** Injectable search, so tests can make one day fail. */
  search?: typeof runSearch;
}

export async function getDayPrices(query: TripQuery, options: DayPricesOptions = {}): Promise<DayPrice[]> {
  const now = options.now ?? new Date();
  const today = isoToday(now);
  const from = options.from ?? today;
  const days = Math.max(1, Math.min(options.days ?? DATE_STRIP_DAYS, 31));
  const search = options.search ?? runSearch;

  const dates = Array.from({ length: days }, (_, index) => addDays(from, index));

  const prices = await Promise.all(
    dates.map(async (date): Promise<DayPrice> => {
      // A past day is not "cheap", it is gone: no price, no search.
      if (diffDays(today, date) < 0) {
        return {
          date,
          label: formatJalaliFull(date),
          cheapestToman: null,
          flightsCount: 0,
          soldOutCount: 0,
          airlineCode: null,
          fastestMinutes: null,
          state: "empty",
          isToday: false,
        };
      }
      try {
        const dayQuery: TripQuery = { ...query, departDate: date };
        const outcome = await search(dayQuery, { now });
        const groups = groupOffers(outcome.offers);
        let cheapest: number | null = null;
        let cheapestCarrier: string | null = null;
        let fastest: number | null = null;
        let soldOut = 0;
        for (const group of groups) {
          const block = group.primary.durationMinutes;
          if (block > 0 && (fastest === null || block < fastest)) fastest = block;
          const selection = selectCheapestOffer(group, {
            passengers: query.passengers,
            cabin: query.cabin,
            now,
          });
          if (selection.cheapest === null) {
            soldOut += 1;
            continue;
          }
          if (cheapest === null || selection.cheapest.price.toman < cheapest) {
            cheapest = selection.cheapest.price.toman;
            cheapestCarrier = selection.cheapest.airlineCode;
          }
        }
        return {
          date,
          label: formatJalaliFull(date),
          cheapestToman: cheapest,
          flightsCount: groups.length,
          soldOutCount: soldOut,
          airlineCode: cheapestCarrier,
          fastestMinutes: fastest,
          state: cheapest === null ? "empty" : "ok",
          isToday: date === today,
        };
      } catch {
        // One broken day is one broken chip, not a broken page.
        return {
          date,
          label: formatJalaliFull(date),
          cheapestToman: null,
          flightsCount: 0,
          soldOutCount: 0,
          airlineCode: null,
          fastestMinutes: null,
          state: "error",
          isToday: date === today,
        };
      }
    }),
  );

  return prices;
}

/** Cheapest price across the strip, for the "cheapest day" nudge. */
export function cheapestDay(prices: DayPrice[]): DayPrice | null {
  let best: DayPrice | null = null;
  for (const price of prices) {
    if (price.cheapestToman === null) continue;
    if (best === null || (best.cheapestToman !== null && price.cheapestToman < best.cheapestToman)) best = price;
  }
  return best;
}
