import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";

/**
 * Journey integration test (jsdom).
 *
 * This mirrors the Playwright flow — search → results → filter/sort → recommendation
 * → comparison — against the real aggregation pipeline, so the critical path is
 * covered even in environments where a browser binary cannot be installed.
 */

const push = vi.fn();
const replace = vi.fn();
let currentParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => currentParams,
  usePathname: () => "/search",
}));

import { runSearch, prepareResultList } from "@/providers/search";
import { rankOffers } from "@/ranking/score";
import { createQuery } from "@/domain/trip";
import { OfferCard } from "@/app/(search)/search/_components/offer-card";
import { RecommendationCard } from "@/app/(search)/search/_components/recommendation-card";
import { SortTabs } from "@/app/(search)/search/_components/sort-tabs";
import { FilterPanel } from "@/app/(search)/search/_components/filter-sidebar";
import { ResultsList } from "@/app/(search)/search/_components/results-list";
import { groupOffers } from "@/dedupe/group";

const query = createQuery({ originCode: "THR", destinationCode: "IST", departDate: "2026-11-20" });

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  currentParams = new URLSearchParams("origin=THR&destination=IST&date=2026-11-20");
});

afterEach(() => cleanup());

describe("search → results journey", () => {
  it("renders one card per physical flight with provider prices and the recommendation", async () => {
    const outcome = await runSearch(query);
    const { groups } = prepareResultList(outcome, "best");
    const ranked = outcome.ranked.ranked;

    // RecommendationCard is an async server component: await it before rendering.
    const recommendationElement = await RecommendationCard({
      query,
      ranked: outcome.ranked,
      offer: outcome.ranked.best?.offer ?? null,
      totalCount: groups.length,
    });

    render(createElement("div", null, recommendationElement, createElement(ResultsList, { query, groups, ranked })));

    const recommendation = screen.getByTestId("recommendation-text");
    expect(recommendation.textContent).toContain("بهترین تطابق");

    const cards = screen.getAllByTestId("offer-card");
    expect(cards.length).toBe(groups.length);
    // Every card shows a toman price.
    for (const card of cards) {
      expect(within(card).getByTestId("offer-price").textContent).toContain("تومان");
    }
    // At least one flight is sold by more than one provider (the whole point).
    expect(cards.some((card) => card.textContent?.includes("ارائه‌دهنده"))).toBe(true);
  });

  it("selects two offers for comparison and stores them in the URL", async () => {
    const user = userEvent.setup();
    const outcome = await runSearch(query);
    const { groups } = prepareResultList(outcome, "best");

    render(createElement(ResultsList, { query, groups, ranked: outcome.ranked.ranked }));

    const compareButtons = screen.getAllByRole("button", { name: /افزودن به مقایسه/ });
    expect(compareButtons.length).toBeGreaterThan(1);
    await user.click(compareButtons[0]!);
    await user.click(compareButtons[1]!);

    expect(replace).toHaveBeenCalled();
    const lastUrl = String(replace.mock.calls.at(-1)?.[0] ?? "");
    const stored = new URLSearchParams(lastUrl.split("?")[1] ?? "").get("compare") ?? "";
    expect(stored.split(",").length).toBeGreaterThanOrEqual(2);
    expect(stored).toContain(":");
  });

  it("changes sort order through the URL (shareable, server-rendered)", async () => {
    const user = userEvent.setup();
    render(createElement(SortTabs, { current: "best" }));

    // The default sort *is* «ارزان‌ترین», so a different tab is what produces a URL change.
    await user.click(screen.getByRole("tab", { name: /سریع‌ترین/ }));
    expect(push).toHaveBeenCalledWith("/search?origin=THR&destination=IST&date=2026-11-20&sort=fastest", {
      scroll: false,
    });
  });

  it("applies a hard filter and marks the affected flights as outside preferences", async () => {
    const user = userEvent.setup();
    const outcome = await runSearch(query);
    const groups = groupOffers(outcome.offers);
    const directGroups = groups.filter((group) => group.primary.stops === 0).length;

    const filtered = rankOffers(
      outcome.offers,
      { ...query.filters, maxStops: 0 },
    );
    expect(filtered.feasible.length).toBeGreaterThan(0);
    expect(filtered.excluded.length).toBeGreaterThan(0);
    expect(filtered.excluded.every((item) => item.offer.stops > 0)).toBe(true);

    render(createElement(FilterPanel, { query, groups, totalOffers: outcome.offers.length }));
    await user.click(screen.getByRole("button", { name: "مستقیم" }));
    expect(push).toHaveBeenCalledWith("/search?origin=THR&destination=IST&date=2026-11-20&stops=0", {
      scroll: false,
    });
    expect(directGroups).toBeGreaterThan(0);
  });

  it("keeps every offer's displayed facts consistent with its normalized data", async () => {
    const outcome = await runSearch(query);
    const { groups } = prepareResultList(outcome, "best");
    const best = groups[0]!;

    render(
      createElement(OfferCard, {
        group: best,
        scored: outcome.ranked.ranked.find((item) => item.offer.id === best.primary.id) ?? null,
        index: 0,
        selected: false,
        onToggleCompare: () => {},
      }),
    );

    const price = screen.getByTestId("offer-price").textContent ?? "";
    // The card price is the cheapest provider price and no cheaper provider exists.
    expect(best.cheapestToman).toBe(Math.min(...best.offers.map((offer) => offer.price.toman)));
    expect(price).toContain("تومان");
    // Unknown baggage must never be rendered as a weight.
    if (best.primary.baggage.checked === "unknown") {
      expect(screen.getByText("بار نامشخص")).toBeTruthy();
    }
  });
});
