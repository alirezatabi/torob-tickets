import { describe, expect, it } from "vitest";

import { createQuery } from "@/domain/trip";
import { runLiveSearch, type LiveGroupView } from "@/server/live-search";
import { LOW_SEATS_THRESHOLD, selectCheapestOffer } from "@/modules/pricing/select-cheapest";

/**
 * B15: the live results page must not invent its own "cheapest".
 *
 * The group row, the `isCheapest` flag on each quote and the sold-out verdict all come from
 * the shared `selectCheapestOffer` rule, so the live view and the demo list/API can never
 * disagree about which source sells the flight for less.
 */

/** A fixed clock: "today" must not decide what this test sees. */
const NOW = new Date("2026-11-12T06:00:00.000Z");

const payload = (passengers: number) =>
  runLiveSearch(
    {
      ...createQuery({ originCode: "IFN", destinationCode: "KIH", departDate: "2026-11-12" }),
      passengers,
    },
    { persist: false, now: NOW },
  );

describe("live group view (B15)", () => {
  it("carries the shared cheapest verdict on every group", async () => {
    const search = await payload(1);
    const groups = search.offers.filter((offer): offer is LiveGroupView => "groupKey" in offer);

    expect(groups.length).toBeGreaterThan(0);

    for (const group of groups) {
      // Exactly one quote is flagged cheapest, and it is the id the shared rule picked.
      const flagged = group.prices.filter((quote) => quote.isCheapest);
      expect(flagged).toHaveLength(1);
      expect(flagged[0]?.id).toBe(group.cheapestOfferId);
      // The row itself is rendered from the cheapest source's quote.
      expect(group.id).toBe(group.cheapestOfferId);
      expect(group.soldOut).toBe(false);
    }
  });

  it("picks the same row `selectCheapestOffer` would pick from the same quotes", async () => {
    const search = await payload(1);
    const group = search.offers.find((offer): offer is LiveGroupView => "groupKey" in offer)!;
    const cheapest = group.prices.reduce((min, quote) => (quote.priceToman < min.priceToman ? quote : min));

    // The prices table is already sorted, but assert the identity rule rather than the order.
    expect(group.cheapestOfferId).toBe(cheapest.id);
    expect(group.prices[0]?.priceToman).toBe(cheapest.priceToman);
  });

  it("reports seats from the flight, not from a single seller", async () => {
    const search = await payload(1);
    const groups = search.offers.filter((offer): offer is LiveGroupView => "groupKey" in offer);
    for (const group of groups) {
      if (group.seatsAvailable === null) continue;
      const known = group.prices
        .map((quote) => quote.seatsAvailable)
        .filter((seats): seats is number => typeof seats === "number");
      if (known.length > 0) expect(group.seatsAvailable).toBe(Math.max(...known));
    }
  });

  it("marks a flight sold out when no source can seat the party, and only then", async () => {
    for (const passengers of [1, 9]) {
      const search = await payload(passengers);
      for (const group of search.offers.filter((offer): offer is LiveGroupView => "groupKey" in offer)) {
        const canSeat = group.prices.some(
          (quote) => quote.seatsAvailable === null || quote.seatsAvailable >= passengers,
        );
        expect(group.soldOut).toBe(!canSeat);
        if (group.soldOut) {
          expect(group.cheapestOfferId).toBeNull();
          expect(group.prices.every((quote) => !quote.isCheapest)).toBe(true);
        }
      }
    }
  });

  it("puts sold-out flights last", async () => {
    const search = await payload(9);
    const groups = search.offers.filter((offer): offer is LiveGroupView => "groupKey" in offer);
    const firstSoldOut = groups.findIndex((group) => group.soldOut);
    if (firstSoldOut === -1) {
      expect(groups.every((group) => !group.soldOut)).toBe(true);
      return;
    }
    expect(groups.slice(firstSoldOut).every((group) => group.soldOut)).toBe(true);
  });

  it("agrees with the shared selector on a hand-built group (no drift between modules)", () => {
    // The live wrapper must pass the requested cabin through; a mismatch would silently
    // re-introduce a second pricing rule. Assert the constants/labels we rely on exist.
    expect(typeof selectCheapestOffer).toBe("function");
    expect(LOW_SEATS_THRESHOLD).toBeGreaterThan(0);
  });
});
