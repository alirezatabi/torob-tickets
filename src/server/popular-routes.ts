import type { TripQuery } from "@/domain/trip";
import { DEFAULT_PREFERENCES } from "@/domain/trip";
import { formatJalali, addDays, isoToday } from "@/lib/jalali";
import { getCity } from "@/lib/cities";
import { getDayPrices } from "@/server/day-prices";

/**
 * “پرفروش‌ترین مسیرهای امروز” — the homepage's honest best-seller list.
 *
 * Why it is not a popularity counter: this demo has no sales, so a “sold 1,240 tickets” badge
 * would be a lie. What it *can* say truthfully is which of the demo's routes offer the cheapest
 * fare today, because that number comes from the same `selectCheapestOffer` the results page
 * uses. So every card is **a price**, not a sales figure, and the section says so.
 *
 * Sorting is “cheapest fare of the route” — the ranking a traveller can act on now. A route with
 * no flight, or with nothing purchasable, is dropped rather than shown with a fake price: an
 * empty card on the homepage is worse than one fewer card.
 */

export interface PopularRoute {
  originCode: string;
  destinationCode: string;
  /** Cheapest fare on that route inside the window, in toman. Never zero. */
  priceToman: number;
  /** The day that price belongs to (`YYYY-MM-DD`). */
  date: string;
  /** Jalali short label, e.g. «۲۷ آبان». */
  dateLabel: string;
  /** How many days from today that price is. 0 means today. */
  daysAhead: number;
  /** The carrier of the cheapest fare — shown with its logo. */
  airlineCode: string | null;
  /** Number of physical flights on the route that day. */
  flightsCount: number;
  /** Shortest and longest block time among the cheap day's flights, in minutes. */
  fastestMinutes: number | null;
}

/** The whole strip: the route cards plus the one summary number a “best seller” badge would want. */
export interface HomeFares {
  routes: PopularRoute[];
  /**
   * The window's floor fare and how many flights it was found among — «۴۰ پرواز، از ۱٬۳۷۰٬۰۰۰».
   * Counted from the same pricing pass as the cards, so the kicker can never disagree with them.
   */
  week: {
    priceToman: number;
    /** Flights on the cheap day of each priced route (not days × routes, not estimates). */
    flightsPriced: number;
    routesPriced: number;
    routesChecked: number;
  } | null;
}

export interface PopularRoutesOptions {
  /** Routes to price, `origin:destination` pairs. Curated, not every pair in the catalogue. */
  routes?: readonly (readonly [string, string])[];
  /** How many days ahead to look for each route's best fare. */
  windowDays?: number;
  limit?: number;
  now?: Date;
}

/**
 * Curated short-list: the domestic pairs Iranians actually fly, plus the outbound routes from
 * Tehran. Kept small on purpose — this is a teaser, not a second results page.
 */
export const POPULAR_ROUTE_PAIRS: readonly (readonly [string, string])[] = [
  ["THR", "MHD"],
  ["THR", "KIH"],
  ["THR", "AWZ"],
  ["THR", "SYZ"],
  ["THR", "IST"],
  ["THR", "DXB"],
  ["MHD", "KIH"],
  ["IFN", "KIH"],
];

/** The window is a week: same horizon as the date strip on the results page. */
export const POPULAR_WINDOW_DAYS = 7;

export async function getHomeFares(options: PopularRoutesOptions = {}): Promise<HomeFares> {
  const now = options.now ?? new Date();
  const today = isoToday(now);
  const limit = Math.max(1, options.limit ?? 6);
  const windowDays = Math.max(1, Math.min(options.windowDays ?? POPULAR_WINDOW_DAYS, 31));
  const routes = (options.routes ?? POPULAR_ROUTE_PAIRS).slice(0, 12);

  const priced = await Promise.all(
    routes.map(async ([originCode, destinationCode]): Promise<PopularRoute | null> => {
      const query: TripQuery = {
        mode: "flight",
        tripType: "oneway",
        originCode,
        destinationCode,
        departDate: today,
        returnDate: null,
        passengers: 1,
        cabin: "economy",
        filters: { ...DEFAULT_PREFERENCES },
      };

      let days;
      try {
        days = await getDayPrices(query, { from: today, days: windowDays, now });
      } catch {
        // One bad route must never take the section down.
        return null;
      }

      const options_ = days
        .filter((day) => day.cheapestToman !== null && day.state === "ok")
        .sort((a, b) => (a.cheapestToman! - b.cheapestToman!) || a.date.localeCompare(b.date));

      const best = options_[0];
      if (!best || best.cheapestToman === null) return null;

      return {
        originCode,
        destinationCode,
        priceToman: best.cheapestToman,
        date: best.date,
        dateLabel: formatJalali(best.date),
        daysAhead: days.findIndex((day) => day.date === best.date),
        airlineCode: best.airlineCode ?? null,
        flightsCount: best.flightsCount,
        fastestMinutes: best.fastestMinutes ?? null,
      };
    }),
  );

  const sorted = priced
    .filter((route): route is PopularRoute => route !== null)
    .sort((a, b) => a.priceToman - b.priceToman || a.daysAhead - b.daysAhead);

  const floor = sorted[0];
  return {
    routes: sorted.slice(0, limit),
    week: floor
      ? {
          priceToman: floor.priceToman,
          flightsPriced: sorted.reduce((sum, route) => sum + route.flightsCount, 0),
          routesPriced: sorted.length,
          routesChecked: routes.length,
        }
      : null,
  };
}

/** Convenience wrapper for callers that only need the cards. */
export async function getPopularRoutes(options: PopularRoutesOptions = {}): Promise<PopularRoute[]> {
  return (await getHomeFares(options)).routes;
}

/** `{fa}` label of the two endpoints, or the codes when the catalogue does not know them. */
export function popularRouteLabel(route: PopularRoute): { from: string; to: string } {
  return {
    from: getCity(route.originCode)?.fa ?? route.originCode,
    to: getCity(route.destinationCode)?.fa ?? route.destinationCode,
  };
}

/** The next 7 days, for a calm “as of” line under the section title. */
export function popularWindowLabel(now: Date = new Date()): string {
  const today = isoToday(now);
  return `${formatJalali(today)} تا ${formatJalali(addDays(today, POPULAR_WINDOW_DAYS - 1))}`;
}
