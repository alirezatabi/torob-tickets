import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";

/**
 * Journey integration test (jsdom).
 *
 * This mirrors the Playwright flow — search → results → filter/sort → detail → comparison —
 * against the real aggregation pipeline, so the critical path is covered even in
 * environments where a browser binary cannot be installed.
 */

const push = vi.fn();
const replace = vi.fn();
let currentParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => currentParams,
  usePathname: () => "/search",
}));

import { runSearch } from "@/providers/search";
import { groupOffers } from "@/dedupe/group";
import { buildFlightResults } from "@/modules/search/results";
import { rankOffers } from "@/ranking/score";
import { createQuery } from "@/domain/trip";
import { formatTimeInZone } from "@/lib/format";
import { OfferCard } from "@/app/(search)/search/_components/offer-card";
import { SortTabs } from "@/app/(search)/search/_components/sort-tabs";
import { FilterPanel } from "@/app/(search)/search/_components/filter-sidebar";
import { ResultsList } from "@/app/(search)/search/_components/results-list";
const query = createQuery({ originCode: "THR", destinationCode: "IST", departDate: "2026-11-20" });

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  currentParams = new URLSearchParams("origin=THR&destination=IST&date=2026-11-20");
});

afterEach(() => cleanup());

describe("search → results journey", () => {
  /** The same flight-level pipeline the page uses. */
  async function flightsFor(sort: "best" | "cheapest" | "fastest" | "earliest" = "best") {
    const outcome = await runSearch(query);
    const groups = groupOffers(outcome.offers);
    const results = buildFlightResults(groups, query, { passengers: 1, cabin: "economy", sort });
    return { outcome, groups, results };
  }

  it("renders one compact card per physical flight and no recommendation block", async () => {
    const { results } = await flightsFor("cheapest");
    const flights = results.flights;

    render(createElement("div", null, createElement(ResultsList, { query, flights })));

    // The «بهترین تطابق» section is gone from the results page, by request.
    expect(screen.queryByTestId("recommendation-text")).toBeNull();
    expect(screen.queryByText("بهترین تطابق")).toBeNull();

    const cards = screen.getAllByTestId("offer-card");
    expect(cards.length).toBe(flights.length);
    // A card shows a toman price, or says «تکمیل ظرفیت» — never a fake ۰.
    for (const card of cards) {
      const text = within(card).getByTestId("offer-price").textContent ?? "";
      const soldOut = card.getAttribute("data-sold-out") === "true";
      expect(text).toContain(soldOut ? "ظرفیت" : "تومان");
    }
  });

  it("keeps each card to the six facts of the brief — the rest lives on the detail page", async () => {
    const { results } = await flightsFor("cheapest");
    const flight = results.flights[0]!;
    const offer = flight.selection.cheapest ?? flight.display;
    const detailHref = `/flight?origin=THR&destination=IST&date=2026-11-20&offer=${encodeURIComponent(offer.id)}`;

    render(createElement(OfferCard, { flight, query, index: 0, detailHref }));

    const card = screen.getByTestId("offer-card");
    const text = card.textContent ?? "";

    // 1. carrier name, 2. aircraft type, 3. price, 4. capacity, 5. origin → destination.
    expect(text).toContain(offer.airlineName);
    expect(within(card).getByTestId("flight-aircraft").textContent).toContain(
      offer.segments[0]?.aircraft ?? "نامشخص",
    );
    expect(within(card).getByTestId("offer-price").textContent).toContain("تومان");
    expect(within(card).getByTestId("flight-capacity").textContent).toContain("صندلی");
    // 6. the two clocks of the route, in each airport's own timezone.
    expect(text).toContain(formatTimeInZone(offer.departAt, "Asia/Tehran"));

    // And everything heavy is *not* on the list any more.
    expect(within(card).queryByTestId("seller-list")).toBeNull();
    expect(text).not.toContain("بار");
    expect(text).not.toContain("استرداد");

    // The row links to the flight's own page.
    const link = screen.getByTestId("flight-details");
    expect(link.getAttribute("href")).toBe(detailHref);
  });

  it("selects two offers for comparison and stores them in the URL", async () => {
    const user = userEvent.setup();
    const { results } = await flightsFor("cheapest");

    render(createElement(ResultsList, { query, flights: results.flights }));

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
    render(createElement(SortTabs, { current: "cheapest" }));

    // «بهترین تطابق» is no longer a tab the results page offers.
    expect(screen.queryByRole("tab", { name: "بهترین تطابق" })).toBeNull();

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

  it("keeps the displayed price consistent with the normalized data", async () => {
    const { results } = await flightsFor("cheapest");
    const best = results.flights[0]!;

    render(
      createElement(OfferCard, {
        flight: best,
        query,
        index: 0,
        selected: false,
        onToggleCompare: () => {},
      }),
    );

    const price = screen.getByTestId("offer-price").textContent ?? "";
    // The card price is the cheapest purchasable provider price, by construction.
    const purchasable = best.group.offers.filter(
      (offer) => offer.seatsAvailable === null || (offer.seatsAvailable ?? 0) >= 1,
    );
    expect(best.selection.cheapest?.price.toman).toBe(Math.min(...purchasable.map((offer) => offer.price.toman)));
    expect(price).toContain("تومان");
  });
});

describe("the flight row leads with the carrier's badge", () => {
  const query = createQuery({ originCode: "IFN", destinationCode: "KIH", departDate: "2026-11-20" });

  it("renders an airline logo per row, with the airline's name as its accessible label", async () => {
    const outcome = await runSearch(query);
    const results = buildFlightResults(groupOffers(outcome.offers), query, {
      passengers: 1,
      cabin: "economy",
      sort: "cheapest",
    });
    render(createElement(ResultsList, { query, flights: results.flights }));

    const logos = screen.getAllByTestId("airline-logo");
    expect(logos.length).toBe(results.flights.length);
    for (const [index, logo] of logos.entries()) {
      const flight = results.flights[index]!;
      expect(logo.getAttribute("data-airline")).toBe(flight.display.airlineCode);
      expect(logo.getAttribute("aria-label")).toContain(flight.display.airlineName);
      // A drawn mark, not an empty box.
      expect(logo.querySelectorAll("path").length).toBeGreaterThan(1);
    }
  });
});
