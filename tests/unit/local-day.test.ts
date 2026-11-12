import { describe, expect, it } from "vitest";
import { createQuery } from "@/domain/trip";
import { groupOffers, canonicalGroupKey, departDayOf } from "@/dedupe/group";
import { runSearch } from "@/providers/search";
import { isWithinSalesWindow, SALES_CUTOFF_MINUTES, tripMatchesOfferDate } from "@/ranking/score";
import { assembleOffer } from "@/providers/normalize";
import { demoSeats, guaranteedCoverage, minSellers } from "@/providers/fixtures";
import { haversineKm, blockMinutesFor, baseFareFor, patternsForRoute } from "@/lib/schedules";
import { seededUnit } from "@/lib/time";
import { airlineLabel } from "@/lib/airlines";

/**
 * Phase A of prompt 02: the day a flight belongs to is a **local** fact, the demo dataset
 * really covers a non-Tehran domestic route, and capacity exists at all.
 */

function offerAt(departAtUtc: string, extra: { flightNumber?: string | null; providerId?: string } = {}) {
  return assembleOffer({
    providerId: extra.providerId ?? "pars",
    providerName: "پارس‌فلایت",
    rawId: `x-${departAtUtc}`,
    airlineCode: "IR",
    flightNumber: extra.flightNumber === undefined ? "IR-452" : extra.flightNumber,
    segments: [
      {
        airlineCode: "IR",
        flightNumber: extra.flightNumber === undefined ? "IR-452" : extra.flightNumber,
        originCode: "THR",
        destinationCode: "MHD",
        departAt: departAtUtc,
        arriveAt: new Date(new Date(departAtUtc).getTime() + 90 * 60_000).toISOString(),
        aircraft: "Airbus A320",
      },
    ],
    price: { amount: 3_000_000, currency: "IRT" },
    baggage: { checked: "included", cabinKg: 7, checkedKg: 20 },
    refundable: false,
    cabin: "economy",
    offerUrl: "/search?date=2026-11-20",
    providerUpdatedAt: "2026-11-19T10:00:00.000Z",
    fetchedAt: "2026-11-19T10:00:00.000Z",
    dataSource: "demo",
  });
}

describe("local departure day (B3/B4/B5)", () => {
  it("treats a 00:30 Tehran departure as that local day, not the previous UTC day", () => {
    // 00:30 on 29 Aban in Tehran is 21:00 UTC on 28 Aban.
    const offer = offerAt("2026-11-19T21:00:00.000Z");
    expect(offer.departAt.slice(0, 10)).toBe("2026-11-19"); // the UTC trap
    expect(departDayOf(offer)).toBe("2026-11-20");
    expect(canonicalGroupKey(offer)).toContain("|2026-11-20|");
  });

  it("treats a 23:30 Tehran departure as the same local day", () => {
    const offer = offerAt("2026-11-20T20:00:00.000Z");
    expect(departDayOf(offer)).toBe("2026-11-20");
  });

  it("filters offers by the requested local day", () => {
    const query = createQuery({ originCode: "THR", destinationCode: "MHD", departDate: "2026-11-20" });
    expect(tripMatchesOfferDate(query, offerAt("2026-11-19T21:00:00.000Z"))).toBe(true);
    expect(tripMatchesOfferDate(query, offerAt("2026-11-20T20:00:00.000Z"))).toBe(true);
    // 21:30 UTC on the 20th is 01:00 on the 21st in Tehran: a different flight day.
    expect(tripMatchesOfferDate(query, offerAt("2026-11-20T21:30:00.000Z"))).toBe(false);
  });

  it("never puts two local days into one group", () => {
    const groups = groupOffers([offerAt("2026-11-19T21:00:00.000Z"), offerAt("2026-11-20T21:30:00.000Z")]);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => departDayOf(group.primary)).sort()).toEqual(["2026-11-20", "2026-11-21"]);
  });

  it("hides a departure inside the 90-minute sales cutoff", () => {
    const now = new Date("2026-11-20T06:00:00.000Z");
    const soon = offerAt("2026-11-20T07:00:00.000Z", { flightNumber: "IR-100" }); // 60 min ahead
    const later = offerAt("2026-11-20T09:00:00.000Z", { flightNumber: "IR-101" }); // 180 min ahead
    expect(SALES_CUTOFF_MINUTES).toBe(90);
    expect(isWithinSalesWindow(soon, now)).toBe(false);
    expect(isWithinSalesWindow(later, now)).toBe(true);
  });
});

describe("runSearch keeps only the requested local day", () => {
  const query = createQuery({ originCode: "IFN", destinationCode: "KIH", departDate: "2026-11-20" });

  it("drops offers from other days instead of accepting everything", async () => {
    const outcome = await runSearch(query, { now: new Date("2026-11-01T08:00:00Z") });
    expect(outcome.offers.length).toBeGreaterThan(0);
    expect(outcome.offers.every((offer) => tripMatchesOfferDate(query, offer))).toBe(true);
    expect(outcome.offers.every((offer) => isWithinSalesWindow(offer, new Date("2026-11-01T08:00:00Z")))).toBe(true);
  });

  it("is reproducible for an injected clock", async () => {
    const now = new Date("2026-11-05T08:00:00Z");
    const a = await runSearch(query, { now });
    const b = await runSearch(query, { now });
    expect(a.offers.map((o) => `${o.id}:${o.price.toman}:${o.seatsAvailable}`)).toEqual(
      b.offers.map((o) => `${o.id}:${o.price.toman}:${o.seatsAvailable}`),
    );
  });
});

describe("domestic mesh coverage (B7)", () => {
  it("has both directions for every non-Tehran pair in the reference scenario", () => {
    const pairs: [string, string][] = [
      ["IFN", "KIH"],
      ["MHD", "KIH"],
      ["SYZ", "KIH"],
      ["IFN", "MHD"],
      ["IFN", "SYZ"],
      ["SYZ", "MHD"],
      ["TBZ", "KIH"],
      ["AWZ", "KIH"],
      ["BND", "KIH"],
      ["IFN", "AWZ"],
    ];
    for (const [from, to] of pairs) {
      expect(patternsForRoute(from, to, "2026-11-20").length, `${from}>${to}`).toBeGreaterThan(0);
      expect(patternsForRoute(to, from, "2026-11-20").length, `${to}>${from}`).toBeGreaterThan(0);
    }
  });

  it("schedules Isfahan → Kish with Iran Air around 13:00 and Kish Air around 19:00", () => {
    const patterns = patternsForRoute("IFN", "KIH", "2026-11-20");
    const iranAir = patterns.find((pattern) => pattern.airlineCode === "IR");
    const kishAir = patterns.find((pattern) => pattern.airlineCode === "Y9");
    expect(iranAir).toBeTruthy();
    expect(kishAir).toBeTruthy();
    expect(Math.abs((iranAir?.departMinutes ?? 0) - 13 * 60)).toBeLessThanOrEqual(30);
    expect(Math.abs((kishAir?.departMinutes ?? 0) - 19 * 60)).toBeLessThanOrEqual(30);
    expect(iranAir?.days).toHaveLength(7);
    expect(kishAir?.days).toHaveLength(7);
    expect(airlineLabel("Y9")).toContain("کیش");
  });

  it("derives duration and fare from distance, not from hand-picked numbers", () => {
    const ifnKih = haversineKm("IFN", "KIH");
    const ifnMhd = haversineKm("IFN", "MHD");
    expect(ifnKih).toBeGreaterThan(700);
    expect(blockMinutesFor(ifnKih)).toBeGreaterThan(60);
    expect(blockMinutesFor(ifnKih)).toBe(blockMinutesFor(ifnKih));
    // A longer hop takes longer and costs more.
    expect(blockMinutesFor(ifnMhd)).toBeGreaterThan(blockMinutesFor(ifnKih) - 1);
    expect(baseFareFor(ifnKih)).toBeGreaterThan(1_000_000);
  });
});

describe("demo sellers and capacity (B6)", () => {
  it("gives every reference flight at least three sellers with different prices", async () => {
    const query = createQuery({ originCode: "IFN", destinationCode: "KIH", departDate: "2026-11-20" });
    const outcome = await runSearch(query, { now: new Date("2026-11-01T08:00:00Z") });
    const groups = groupOffers(outcome.offers);
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(minSellers()).toBe(3);
    for (const group of groups) {
      expect(group.providers.length, group.groupKey).toBeGreaterThanOrEqual(3);
      expect(new Set(group.providers.map((provider) => provider.priceToman)).size).toBeGreaterThan(1);
    }
  });

  it("fills the seller gap deterministically and per flight", () => {
    const first = ["pars", "alibaba", "flightio", "mahan"].map((id) => guaranteedCoverage(id, "ifn-kih-y9-7204"));
    const second = ["pars", "alibaba", "flightio", "mahan"].map((id) => guaranteedCoverage(id, "ifn-kih-y9-7204"));
    expect(first).toEqual(second);
    expect(first.filter(Boolean).length).toBeGreaterThanOrEqual(3);
  });

  it("gives demo offers seats in 0..9, deterministically, without Math.random", () => {
    const seats = demoSeats("pars", "ifn-kih-ir-3301", "2026-11-20");
    expect(seats).toBe(demoSeats("pars", "ifn-kih-ir-3301", "2026-11-20"));
    for (const date of ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"]) {
      const value = demoSeats("pars", "ifn-kih-ir-3301", date);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(9);
    }
  });

  it("stays inside [0,1) for the hash edge case (B18)", () => {
    for (const seed of ["", "a", "pars:x", "seats:pars:ifn-kih-ir-3301:2026-11-20"]) {
      const value = seededUnit(seed);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
