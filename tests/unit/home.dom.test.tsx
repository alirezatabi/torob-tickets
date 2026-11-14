import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
}));

import { SearchForm } from "@/app/(home)/_components/search-form";
import { getPopularRoutes, POPULAR_ROUTE_PAIRS } from "@/server/popular-routes";

/** The homepage never fills missing local Safarmarket snapshots with sample fares. */
describe("homepage", () => {
  it("leaves origin and destination empty", () => {
    render(createElement(SearchForm));
    // Both comboboxes show their prompt, not a city the user never picked.
    expect(screen.getByRole("combobox", { name: "مبدأ" }).textContent).toContain("از کجا؟");
    expect(screen.getByRole("combobox", { name: "مقصد" }).textContent).toContain("به کجا؟");
    expect(screen.getByRole("combobox", { name: "مبدأ" }).textContent).not.toContain("تهران");
  });

  it("does not create homepage fares when no local real snapshot exists", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const routes = await getPopularRoutes({ limit: 4, routes: POPULAR_ROUTE_PAIRS.slice(0, 3) });
      expect(routes).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
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
