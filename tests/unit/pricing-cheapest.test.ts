import { describe, expect, it } from "vitest";
import type { FlightOffer, OfferGroup } from "@/domain/flight";
import {
  BAGGAGE_PREMIUM_PERCENT,
  flightCapacity,
  LOW_SEATS_THRESHOLD,
  selectCheapestOffer,
} from "@/modules/pricing/select-cheapest";
import { assembleOffer } from "@/providers/normalize";

/**
 * `selectCheapestOffer` is the single source of truth for "the price of this flight".
 * These tests are the specification of prompt 02 §4.2, one rule per test.
 */

let counter = 0;

function offer(overrides: {
  providerId?: string;
  price?: number;
  seats?: number | null;
  cabin?: "economy" | "premium" | "business";
  baggage?: "included" | "not-included" | "unknown";
  freshness?: FlightOffer["freshness"];
  comparable?: boolean;
  completeness?: number;
  updatedAt?: string;
  flightNumber?: string | null;
  departAt?: string;
}): FlightOffer {
  counter += 1;
  const base = assembleOffer({
    providerId: overrides.providerId ?? "pars",
    providerName: overrides.providerId ?? "پارس‌فلایت",
    rawId: `row-${counter}`,
    airlineCode: "IR",
    flightNumber: overrides.flightNumber === undefined ? "IR-3301" : overrides.flightNumber,
    segments: [
      {
        airlineCode: "IR",
        flightNumber: overrides.flightNumber === undefined ? "IR-3301" : overrides.flightNumber,
        originCode: "IFN",
        destinationCode: "KIH",
        departAt: overrides.departAt ?? "2026-11-20T09:30:00.000Z",
        arriveAt: "2026-11-20T11:15:00.000Z",
        aircraft: null,
      },
    ],
    price: { amount: overrides.price ?? 5_000_000, currency: "IRT" },
    baggage: {
      checked: overrides.baggage ?? "included",
      cabinKg: 7,
      checkedKg: overrides.baggage === "not-included" ? null : 20,
    },
    refundable: false,
    cabin: overrides.cabin ?? "economy",
    offerUrl: "/search?date=2026-11-20",
    providerUpdatedAt: overrides.updatedAt ?? "2026-11-20T08:00:00.000Z",
    fetchedAt: "2026-11-20T08:00:00.000Z",
    dataSource: "demo",
    seatsAvailable: overrides.seats === undefined ? 9 : overrides.seats,
  });
  return {
    ...base,
    ...(overrides.freshness ? { freshness: overrides.freshness } : {}),
    ...(overrides.completeness !== undefined ? { completeness: overrides.completeness } : {}),
    ...(overrides.comparable !== undefined ? { price: { ...base.price, comparable: overrides.comparable } } : {}),
  };
}

function group(offers: FlightOffer[]): OfferGroup {
  const sorted = [...offers].sort((a, b) => a.price.toman - b.price.toman);
  return {
    groupKey: "IR|IR3301|2026-11-20|IFN>KIH",
    primary: sorted[0] as FlightOffer,
    offers: sorted,
    cheapestToman: sorted[0]?.price.toman ?? 0,
    providers: [],
    hasPriceSpread: false,
    flightNumber: "IR-3301",
    identity: "flight-number",
    knownSellers: offers.length,
  };
}

describe("selectCheapestOffer", () => {
  it("picks the lowest price among eligible offers", () => {
    const selection = selectCheapestOffer(group([offer({ price: 5_000_000 }), offer({ price: 4_200_000 })]), {
      passengers: 1,
    });
    expect(selection.cheapest?.price.toman).toBe(4_200_000);
    expect(selection.savingsToman).toBe(800_000);
    expect(selection.totalToman).toBe(4_200_000);
  });

  it("multiplies the total by the passenger count but keeps the per-person price", () => {
    const selection = selectCheapestOffer(group([offer({ price: 5_000_000, seats: 9 })]), { passengers: 3 });
    expect(selection.cheapest?.price.toman).toBe(5_000_000);
    expect(selection.totalToman).toBe(15_000_000);
  });

  it("breaks a price tie on completeness, then freshness, then provider id", () => {
    const lessComplete = offer({ providerId: "zeta", price: 4_000_000, completeness: 0.5 });
    const moreComplete = offer({ providerId: "alpha", price: 4_000_000, completeness: 0.9 });
    expect(selectCheapestOffer(group([lessComplete, moreComplete]), { passengers: 1 }).cheapest?.providerId).toBe("alpha");

    const older = offer({ providerId: "alpha", price: 4_000_000, updatedAt: "2026-11-19T08:00:00.000Z" });
    const newer = offer({ providerId: "beta", price: 4_000_000, updatedAt: "2026-11-20T07:00:00.000Z" });
    expect(selectCheapestOffer(group([older, newer]), { passengers: 1 }).cheapest?.providerId).toBe("beta");

    // Same everything: the code-point comparison decides, not the machine's locale.
    const a = offer({ providerId: "alibaba", price: 4_000_000 });
    const b = offer({ providerId: "pars", price: 4_000_000 });
    expect(selectCheapestOffer(group([b, a]), { passengers: 1 }).cheapest?.providerId).toBe("alibaba");
  });

  it("treats too few seats as not purchasable, with a Persian reason", () => {
    const selection = selectCheapestOffer(
      group([offer({ providerId: "cheap", price: 3_000_000, seats: 2 }), offer({ providerId: "ok", price: 3_400_000, seats: 4 })]),
      { passengers: 4 },
    );
    expect(selection.cheapest?.providerId).toBe("ok");
    expect(selection.ineligible).toHaveLength(1);
    expect(selection.ineligible[0]?.reason).toBe("capacity");
    expect(selection.ineligible[0]?.reasonFa).toContain("ظرفیت");
  });

  it("accepts an offer whose seat count is unknown", () => {
    const selection = selectCheapestOffer(group([offer({ price: 3_000_000, seats: null })]), { passengers: 9 });
    expect(selection.cheapest?.price.toman).toBe(3_000_000);
    expect(selection.seatsAvailable).toBeNull();
  });

  it("keeps a foreign-currency price out of the comparison", () => {
    const selection = selectCheapestOffer(
      group([offer({ providerId: "eur", price: 1_000_000, comparable: false }), offer({ providerId: "try", price: 6_000_000 })]),
      { passengers: 1 },
    );
    expect(selection.cheapest?.providerId).toBe("try");
    expect(selection.ineligible.map((entry) => entry.reason)).toContain("not-comparable");
  });

  it("drops offers the source marked unavailable and those in another cabin", () => {
    const selection = selectCheapestOffer(
      group([
        offer({ providerId: "gone", price: 1_000_000, freshness: "unavailable" }),
        offer({ providerId: "business", price: 2_000_000, cabin: "business" }),
        offer({ providerId: "economy", price: 3_000_000, cabin: "economy" }),
      ]),
      { passengers: 1, cabin: "economy" },
    );
    expect(selection.cheapest?.providerId).toBe("economy");
    expect(selection.ineligible.map((entry) => entry.reason).sort()).toEqual(["cabin", "unavailable"]);
  });

  it("offers the cheapest fare that includes baggage when it is close in price", () => {
    const selection = selectCheapestOffer(
      group([
        offer({ providerId: "nobag", price: 4_000_000, baggage: "not-included" }),
        offer({ providerId: "withbag", price: 4_500_000, baggage: "included" }),
      ]),
      { passengers: 1 },
    );
    expect(selection.cheapest?.providerId).toBe("nobag");
    expect(selection.cheapestWithBaggage?.providerId).toBe("withbag");
    expect(BAGGAGE_PREMIUM_PERCENT).toBe(15);
  });

  it("does not surface a baggage fare that is far more expensive", () => {
    const selection = selectCheapestOffer(
      group([
        offer({ providerId: "nobag", price: 4_000_000, baggage: "not-included" }),
        offer({ providerId: "withbag", price: 5_200_000, baggage: "included" }),
      ]),
      { passengers: 1 },
    );
    expect(selection.cheapestWithBaggage).toBeNull();
  });

  it("reports the seats of the sellers that can actually serve the group", () => {
    expect(flightCapacity([offer({ seats: 9 }), offer({ seats: 2 })], { passengers: 4 })).toBe(9);
  });

  it("returns null — never a price — when nothing is purchasable", () => {
    const selection = selectCheapestOffer(
      group([offer({ price: 3_000_000, seats: 1 }), offer({ price: 3_100_000, seats: 0 })]),
      { passengers: 4 },
    );
    expect(selection.cheapest).toBeNull();
    expect(selection.totalToman).toBeNull();
    expect(selection.seatsAvailable).toBe(0);
  });

  it("is deterministic for the same input", () => {
    const offers = [offer({ providerId: "b", price: 4_000_000 }), offer({ providerId: "a", price: 4_000_000 })];
    const first = selectCheapestOffer(group(offers), { passengers: 1 });
    const second = selectCheapestOffer(group(offers), { passengers: 1 });
    expect(first.cheapest?.id).toBe(second.cheapest?.id);
  });
});

describe("flight capacity", () => {
  it("is the maximum of the known purchasable offers, never the sum", () => {
    const capacity = flightCapacity(
      [
        offer({ providerId: "a", seats: 3 }),
        offer({ providerId: "b", seats: 7 }),
        offer({ providerId: "c", seats: 5 }),
      ],
      { passengers: 1 },
    );
    expect(capacity).toBe(7);
  });

  it("ignores sellers that cannot serve the requested passengers", () => {
    // Both statements exist, and neither can serve the group: the flight is sold out (0).
    const capacity = flightCapacity(
      [offer({ providerId: "a", seats: 9 }), offer({ providerId: "b", seats: 2 })],
      { passengers: 10 },
    );
    expect(capacity).toBe(0);
  });

  it("is null when nobody states a number", () => {
    expect(flightCapacity([offer({ seats: null }), offer({ seats: null })], { passengers: 1 })).toBeNull();
  });

  it("marks low capacity with a named threshold", () => {
    expect(LOW_SEATS_THRESHOLD).toBe(5);
    const selection = selectCheapestOffer(group([offer({ seats: LOW_SEATS_THRESHOLD })]), { passengers: 1 });
    expect(selection.seatsAvailable).toBe(LOW_SEATS_THRESHOLD);
  });
});
