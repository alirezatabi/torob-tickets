import { describe, expect, it } from "vitest";
import { groupOffers, assertNoUnsafeMerge } from "@/dedupe/group";
import { runSearch } from "@/providers/search";
import { createQuery } from "@/domain/trip";
import type { FlightOffer } from "@/domain/flight";

function offer(overrides: Partial<FlightOffer> & Pick<FlightOffer, "id" | "providerId" | "price">): FlightOffer {
  const base = {
    id: overrides.id,
    groupKey: overrides.groupKey ?? "",
    providerId: overrides.providerId,
    providerName: overrides.providerId,
    airlineCode: "TK",
    airlineName: "ترکیش",
    flightNumber: "TK-873",
    originCode: "THR",
    destinationCode: "IST",
    departAt: "2026-11-20T05:10:00.000Z",
    arriveAt: "2026-11-20T08:15:00.000Z",
    durationMinutes: 185,
    stops: 0,
    segments: [],
    price: overrides.price,
    baggage: { checked: "included" as const, cabinKg: 8, checkedKg: 23 },
    refundable: true,
    cabin: "economy" as const,
    offerUrl: "https://example.com",
    providerUpdatedAt: "2026-11-19T10:00:00.000Z",
    fetchedAt: "2026-11-19T10:00:00.000Z",
    dataSource: "demo" as const,
    warnings: [],
  };
  return { ...base, ...overrides };
}

const price = (amount: number) => ({
  original: { amount, currency: "IRT" as const },
  toman: amount,
  converted: false,
});
const cheap = price(4_000_000);
const pricey = price(4_400_000);

describe("deduplication", () => {
  it("merges the same flight sold by three providers into one group", () => {
    const groups = groupOffers([
      offer({ id: "a:1", providerId: "a", price: pricey }),
      offer({ id: "b:1", providerId: "b", price: cheap }),
      offer({ id: "c:1", providerId: "c", price: pricey }),
    ]);
    expect(groups).toHaveLength(1);
   expect(groups[0]?.providers).toHaveLength(3);
    expect(groups[0]?.cheapestToman).toBe(4_000_000);
    expect(groups[0]?.hasPriceSpread).toBe(true);
  });

  it("joins an offer that lacks a flight number when times and route match", () => {
    const groups = groupOffers([
      offer({ id: "a:1", providerId: "a", price: cheap }),
      offer({ id: "b:1", providerId: "b", price: pricey, flightNumber: null, groupKey: "x" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.providers).toHaveLength(2);
  });

  it("never merges different flight numbers, even at identical price and time", () => {
    const groups = groupOffers([
      offer({ id: "a:1", providerId: "a", price: cheap, flightNumber: "TK-873" }),
      offer({ id: "b:1", providerId: "b", price: cheap, flightNumber: "TK-875" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(() => assertNoUnsafeMerge(groups)).not.toThrow();
  });

  it("never merges different airlines on the same route and time", () => {
    const groups = groupOffers([
      offer({ id: "a:1", providerId: "a", price: cheap, airlineCode: "TK", flightNumber: "TK-873" }),
      offer({ id: "b:1", providerId: "b", price: cheap, airlineCode: "IR", flightNumber: "IR-873" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("never merges the same flight on different days", () => {
    const groups = groupOffers([
      offer({ id: "a:1", providerId: "a", price: cheap }),
      offer({ id: "b:1", providerId: "b", price: cheap, departAt: "2026-11-21T05:10:00.000Z" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("does not merge an unnumbered offer that departs hours away", () => {
    const groups = groupOffers([
      offer({ id: "a:1", providerId: "a", price: cheap }),
      offer({ id: "b:1", providerId: "b", price: cheap, flightNumber: null, departAt: "2026-11-20T12:10:00.000Z" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("collapses a duplicate listing from the same provider into one provider row", () => {
    const groups = groupOffers([
      offer({ id: "a:1", providerId: "a", price: cheap }),
      offer({ id: "a:2", providerId: "a", price: pricey }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.providers).toHaveLength(1);
    expect(groups[0]?.offers).toHaveLength(2);
  });

  it("keeps real aggregated data free of unsafe merges", async () => {
    const outcome = await runSearch(
      createQuery({ originCode: "THR", destinationCode: "IST", departDate: "2026-11-20" }),
    );
    const groups = groupOffers(outcome.offers);
    expect(() => assertNoUnsafeMerge(groups)).not.toThrow();
    expect(groups.length).toBeGreaterThan(5);
    expect(groups.some((group) => group.providers.length > 1)).toBe(true);
  });
});
