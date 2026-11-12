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

  it("never attaches an unnumbered offer to a numbered flight", () => {
    // The product compares *this* flight, not "something on the same airline at the same
    // time". Without a number on one side, one group would mix a confirmed identity with a
    // guess — so they stay separate rows.
    const groups = groupOffers([
      offer({ id: "a:1", providerId: "a", price: cheap }),
      offer({ id: "b:1", providerId: "b", price: pricey, flightNumber: null, groupKey: "x" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.identity).sort()).toEqual(["flight-number", "same-departure"]);
    expect(() => assertNoUnsafeMerge(groups)).not.toThrow();
  });

  it("groups unnumbered quotes of the same departure within five minutes", () => {
    const groups = groupOffers([
      offer({ id: "a:1", providerId: "a", price: cheap, flightNumber: null }),
      offer({
        id: "b:1",
        providerId: "b",
        price: pricey,
        flightNumber: null,
        departAt: "2026-11-20T05:12:00.000Z",
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.identity).toBe("same-departure");
    expect(groups[0]?.providers).toHaveLength(2);
  });

  it("does not stretch that tolerance: 13:00 and 13:40 are different flights", () => {
    const groups = groupOffers([
      offer({ id: "a:1", providerId: "a", price: cheap, flightNumber: null, departAt: "2026-11-20T05:00:00.000Z" }),
      offer({ id: "b:1", providerId: "b", price: pricey, flightNumber: null, departAt: "2026-11-20T05:40:00.000Z" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("reports the flight number and identity on the group, for the UI to state", () => {
    const groups = groupOffers([
      offer({ id: "a:1", providerId: "a", price: cheap, flightNumber: "IR-452" }),
      offer({ id: "b:1", providerId: "b", price: pricey, flightNumber: "IR452" }),
    ]);
    expect(groups).toHaveLength(1);
    // The displayed number is a real source row's, not a normalised key.
    expect(["IR-452", "IR452"]).toContain(groups[0]?.flightNumber);
    expect(groups[0]?.identity).toBe("flight-number");
    expect(groups[0]?.groupKey).toBe("TK|IR452|2026-11-20|THR>IST");
  });

  it("counts the agencies the source declares as a floor on sellers", () => {
    const groups = groupOffers([
      offer({
        id: "a:1",
        providerId: "a",
        price: cheap,
        provenance: {
          sourceKind: "html",
          endpoint: "GET /Flight/B2c/Search",
          rawRecordId: null,
          sellerLabel: "فروش توسط 125 سایت مختلف",
          unitConverted: false,
          mergedRows: 1,
          sellerCount: 125,
        },
      }),
      offer({ id: "b:1", providerId: "b", price: pricey }),
    ]);
    // 125 agencies on one fare beats "2 providers": the number is a floor, not a sum.
    expect(groups[0]?.knownSellers).toBe(125);
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

describe("live grouping (the product promise)", () => {
  it("folds two sources of one real flight into a single row with both prices", async () => {
    const { groupOffers: group } = await import("@/dedupe/group");
    const base = offer({ id: "sepehr360:0", providerId: "sepehr360", price: price(6_800_000) });
    const mirror = offer({ id: "other:0", providerId: "other", price: price(7_038_000) });
    const groups = group([base, mirror]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.providers.map((provider) => provider.providerId)).toEqual(["sepehr360", "other"]);
    expect(groups[0]?.cheapestToman).toBe(6_800_000);
    expect(groups[0]?.hasPriceSpread).toBe(true);
  });

  it("keeps two different flights of the same carrier as two rows even at the same price", () => {
    // W5 1084 and W5 1086 leaving 23 minutes apart: different tickets, different rows.
    const groups = groupOffers([
      offer({ id: "a:1", providerId: "a", price: cheap, flightNumber: "W5-1084", departAt: "2026-11-20T05:00:00.000Z" }),
      offer({ id: "b:1", providerId: "b", price: cheap, flightNumber: "W5-1086", departAt: "2026-11-20T05:23:00.000Z" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(() => assertNoUnsafeMerge(groups)).not.toThrow();
  });
});
