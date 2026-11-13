import { describe, expect, it } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { afterEach } from "vitest";

import { createQuery } from "@/domain/trip";
import { groupOffers } from "@/dedupe/group";
import { buildFlightResults } from "@/modules/search/results";
import { runSearch } from "@/providers/search";
import FlightPage from "@/app/(search)/flight/page";

/**
 * The per-ticket page is where the detail went when the results list got short.
 *
 * It must be a real, shareable URL that renders *all* of a flight's facts — every seller, the
 * baggage and refund terms, the segment timeline, and the honest "we don't know" labels — and
 * it must never invent a price: the number it shows is the one the card showed.
 */

const query = createQuery({ originCode: "IFN", destinationCode: "KIH", departDate: "2026-11-20" });
const NOW = new Date("2026-11-01T08:00:00Z");

async function renderFor(offerId?: string) {
  const element = await FlightPage({
    searchParams: Promise.resolve({
      origin: "IFN",
      destination: "KIH",
      date: "2026-11-20",
      ...(offerId ? { offer: offerId } : {}),
    }),
  } as never);
  return render(createElement("div", null, element));
}

async function firstFlight() {
  const outcome = await runSearch(query, { now: NOW });
  const results = buildFlightResults(groupOffers(outcome.offers), query, {
    passengers: 1,
    cabin: query.cabin,
    sort: "cheapest",
  });
  return results.flights[0]!;
}

afterEach(() => cleanup());

describe("/flight — the per-ticket page", () => {
  it("renders every seller of the flight, with the cheapest as the headline price", async () => {
    const flight = await firstFlight();
    const offerId = flight.selection.cheapest?.id ?? flight.display.id;
    await renderFor(offerId);

    const page = screen.getByTestId("flight-page");
    expect(within(page).getByTestId("flight-title").textContent).toContain(flight.display.airlineName);

    const sellers = within(page).getByTestId("seller-list");
    expect(sellers.querySelectorAll("li").length).toBeGreaterThanOrEqual(3);
    // The cheapest seller is marked exactly once…
    expect(within(sellers).getAllByText("کمترین").length).toBe(1);

    // …and the headline is that seller's price (formatted identically), never a new number.
    const cheapestRow = within(sellers)
      .getAllByText("کمترین")[0]!
      .closest("li") as HTMLElement;
    const rowPrice = cheapestRow.querySelector("p.nums")?.textContent ?? "";
    expect(rowPrice).toContain("تومان");
    expect(within(page).getByTestId("flight-cheapest").textContent).toBe(rowPrice);
  });

  it("shows the facts the results list no longer shows: globe, baggage, refund, segments", async () => {
    const flight = await firstFlight();
    await renderFor(flight.selection.cheapest?.id ?? flight.display.id);

    const text = screen.getByTestId("flight-page").textContent ?? "";
    expect(text).toContain("بار همراه");
    expect(text).toContain("شرایط استرداد");
    expect(text).toContain("پله‌های پرواز");
    // The globe is a real drawing, not a placeholder: it projects the great-circle route.
    const globe = screen.getByTestId("route-globe");
    expect(globe.querySelectorAll("circle").length).toBeGreaterThan(1);
    expect(within(globe).getByTestId("globe-zoom-in")).toBeTruthy();
    expect(within(globe).getByTestId("globe-zoom-out")).toBeTruthy();
    expect(globe.textContent).toContain("کیلومتر");
    // Unknown values are labelled, never guessed.
    expect(text).toMatch(/نامشخص|اعلام نشده|شامل|ندارد|استرداد/);
    // And the honesty note is there.
    expect(text).toContain("دادهٔ نمونه");
  });

  it("falls back to the flight when the URL carries a group key instead of an offer id", async () => {
    const flight = await firstFlight();
    await renderFor(flight.group.groupKey);
    const page = screen.getByTestId("flight-page");
    expect(within(page).getByTestId("seller-list").querySelectorAll("li").length).toBeGreaterThan(0);
  });

  it("explains a link whose offer is not in this search instead of showing a wrong ticket", async () => {
    await renderFor("no-such-provider:does-not-exist");
    expect(screen.getByTestId("flight-error")).toBeTruthy();
    expect(screen.queryByTestId("flight-page")).toBeNull();
  });
});
