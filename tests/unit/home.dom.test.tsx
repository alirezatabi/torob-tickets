import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
}));

import { SearchForm } from "@/app/(home)/_components/search-form";
import { getPopularRoutes, POPULAR_ROUTE_PAIRS } from "@/server/popular-routes";
import { getDayPrices } from "@/server/day-prices";
import { isoToday, diffDays } from "@/lib/jalali";
import { DEFAULT_PREFERENCES } from "@/domain/trip";

/**
 * The homepage asks for a route instead of guessing one, and its "best of the week" strip says
 * only what the demo can prove: the cheapest fare, from the same pricing rule as the results
 * page — never a sales figure this dataset does not have.
 */
describe("homepage", () => {
  it("leaves origin and destination empty", () => {
    render(createElement(SearchForm));
    // Both comboboxes show their prompt, not a city the user never picked.
    expect(screen.getByRole("combobox", { name: "مبدأ" }).textContent).toContain("از کجا؟");
    expect(screen.getByRole("combobox", { name: "مقصد" }).textContent).toContain("به کجا؟");
    expect(screen.getByRole("combobox", { name: "مبدأ" }).textContent).not.toContain("تهران");
  });

  it("prices the strip from the same rule as the results page", async () => {
    const routes = await getPopularRoutes({ limit: 4, routes: POPULAR_ROUTE_PAIRS.slice(0, 3) });
    expect(routes.length).toBeGreaterThan(0);

    for (const route of routes) {
      // The quoted fare is the cheapest *purchasable* fare of that day — recomputed here.
      const days = await getDayPrices(
        {
          mode: "flight",
          tripType: "oneway",
          originCode: route.originCode,
          destinationCode: route.destinationCode,
          departDate: isoToday(),
          returnDate: null,
          passengers: 1,
          cabin: "economy",
          filters: { ...DEFAULT_PREFERENCES },
        },
        { days: 7 },
      );
      const day = days.find((entry) => entry.date === route.date);
      expect(day?.cheapestToman).toBe(route.priceToman);
      expect(route.daysAhead).toBe(Math.max(0, diffDays(isoToday(), route.date)));
      // A card is always a real price and a real day, never a placeholder.
      expect(route.priceToman).toBeGreaterThan(0);
      expect(route.flightsCount).toBeGreaterThan(0);
    }
  });

  it("sorts cheapest first and drops routes with nothing purchasable", async () => {
    // `THR:MRX` has no scheduled flights in the demo, so it must not become a card.
    const routes = await getPopularRoutes({ routes: [["THR", "MRX"], ["THR", "MHD"]], limit: 5 });
    expect(routes.every((route) => route.destinationCode !== "MRX")).toBe(true);
    const prices = routes.map((route) => route.priceToman);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });
});
