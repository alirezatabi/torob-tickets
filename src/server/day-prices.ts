import type { TripQuery } from "@/domain/trip";
import { groupOffers } from "@/dedupe/group";
import { runSearch } from "@/providers/search";
import { selectCheapestOffer } from "@/modules/pricing/select-cheapest";
import { addDays, diffDays, formatJalaliFull, isoToday } from "@/lib/jalali";

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
