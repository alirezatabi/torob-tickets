import { describe, expect, it } from "vitest";

import { createQuery } from "@/domain/trip";
import { groupOffers, rebuildGroup } from "@/dedupe/group";
import type { FlightOffer, OfferGroup } from "@/domain/flight";
import { filterGroups } from "@/lib/filter";
import { runSearch } from "@/providers/search";
import { assembleOffer } from "@/providers/normalize";

/**
 * Display filters only *hide* rows; they must never leave a group describing rows it no
 * longer shows. Every derived field is re-derived from the surviving offers.
 */

const query = createQuery({ originCode: "THR", destinationCode: "IST", departDate: "2026-11-20" });

function assertInternallyConsistent(group: OfferGroup) {
  // Every seller listed is still present, and no provider appears twice.
  const visibleIds = new Set(group.offers.map((offer) => offer.id));
  for (const provider of group.providers) expect(visibleIds.has(provider.offerId)).toBe(true);
  expect(new Set(group.providers.map((provider) => provider.providerId)).size).toBe(group.providers.length);

  // The headline price is the cheapest price still on screen.
  const cheapest = Math.min(...group.offers.map((offer) => offer.price.toman));
  expect(group.cheapestToman).toBe(cheapest);
  expect(group.providers.every((provider) => provider.priceToman >= cheapest)).toBe(true);

  // The representative offer is a row we actually show, at the cheapest price.
  expect(visibleIds.has(group.primary.id)).toBe(true);
  expect(group.primary.price.toman).toBe(cheapest);

  // Seller counts describe the surviving rows, never a larger earlier set.
  expect(group.knownSellers).toBeGreaterThanOrEqual(new Set(group.offers.map((offer) => offer.providerId)).size);
}

let counter = 0;

function offer(input: {
  providerId: string;
  price: number;
  stops?: number;
  baggage?: "included" | "not-included" | "unknown";
  sellerCount?: number;
}): FlightOffer {
  counter += 1;
  const base = assembleOffer({
    providerId: input.providerId,
    providerName: input.providerId,
    rawId: `filter-row-${counter}`,
    airlineCode: "IR",
    flightNumber: "IR-3301",
    segments: [
      {
        airlineCode: "IR",
        flightNumber: "IR-3301",
        originCode: "IFN",
        destinationCode: "KIH",
        departAt: "2026-11-20T09:30:00.000Z",
        arriveAt: "2026-11-20T11:15:00.000Z",
        aircraft: null,
        ...(input.stops ? { stopCodes: ["THR"] } : {}),
      },
    ],
    price: { amount: input.price, currency: "IRT" },
    baggage: { checked: input.baggage ?? "included", cabinKg: 7, checkedKg: 20 },
    refundable: false,
    cabin: "economy",
    offerUrl: "/search?date=2026-11-20",
    providerUpdatedAt: "2026-11-20T08:00:00.000Z",
    fetchedAt: "2026-11-20T08:00:00.000Z",
    dataSource: "demo",
    seatsAvailable: 9,
  });
  return {
    ...base,
    stops: input.stops ?? 0,
    ...(input.sellerCount !== undefined
      ? {
          provenance: {
            sourceKind: "demo" as const,
            endpoint: "fixture://filter-consistency",
            rawRecordId: null,
            sellerLabel: null,
            unitConverted: false,
            mergedRows: 1,
            sellerCount: input.sellerCount,
          },
        }
      : {}),
  };
}

describe("filterGroups keeps groups consistent", () => {
  it("re-derives the derived fields of every narrowed group", async () => {
    const groups = groupOffers((await runSearch(query)).offers);
    const filtered = filterGroups(groups, { ...query.filters, maxStops: 0, baggageRequired: true });

    expect(filtered.visible.length).toBeGreaterThan(0);
    for (const group of filtered.visible) assertInternallyConsistent(group);
  });

  it("drops the cheapest seller's price and count when the cheapest row is filtered out", () => {
    const groups = groupOffers([
      offer({ providerId: "cheap", price: 4_000_000, stops: 1, sellerCount: 40 }),
      offer({ providerId: "mid", price: 5_000_000 }),
      offer({ providerId: "dear", price: 6_000_000 }),
    ]);
    const before = groups[0] as OfferGroup;
    expect(before.providers).toHaveLength(3);
    expect(before.cheapestToman).toBe(4_000_000);
    expect(before.knownSellers).toBe(40);

    const filtered = filterGroups(groups, { ...query.filters, maxStops: 0 });
    const after = filtered.visible[0] as OfferGroup;
    assertInternallyConsistent(after);
    expect(after.offers).toHaveLength(2);
    expect(after.cheapestToman).toBe(5_000_000);
    expect(after.primary.id).not.toBe(before.primary.id);
    // The 40 sellers were that one row's claim; it must not survive its row.
    expect(after.knownSellers).toBe(2);
    expect(after.providers.map((provider) => provider.providerId)).toEqual(["mid", "dear"]);
  });

  it("keeps an untouched group object identical (no needless churn)", () => {
    const [group] = groupOffers([offer({ providerId: "a", price: 1_000_000 }), offer({ providerId: "b", price: 2_000_000 })]);
    const filtered = filterGroups([group as OfferGroup], query.filters);
    expect(filtered.hidden).toBe(0);
    expect(filtered.visible[0]).toBe(group);
  });

  it("rebuildGroup rejects an empty offer set instead of inventing a group", () => {
    expect(() => rebuildGroup("IR|IR3301|2026-11-20|IFN>KIH", [], "flight-number")).toThrow();
  });
});
