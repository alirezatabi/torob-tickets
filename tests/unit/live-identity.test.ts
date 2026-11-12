import { describe, expect, it } from "vitest";

import {
  deterministicOfferId,
  displayGroupKey,
  offerKey,
  routeKey,
  shortHash,
  type FareFacts,
} from "@/modules/live/offer-identity";

const base: FareFacts = {
  airlineCode: "IR",
  flightNumber: "IR-452",
  originAirport: "IKA",
  destinationAirport: "IST",
  departDate: "2026-11-20",
  cabin: "economy",
  fareClass: "Y",
  baggage: ["checked-30kg"],
  refund: "non-refundable",
  ticketType: "system",
  marketingCarrier: null,
};

describe("offerKey (price-history identity)", () => {
  it("is stable for identical facts", () => {
    expect(offerKey(base)).toBe(offerKey({ ...base }));
  });

  it("changes when anything that changes the product changes", () => {
    const key = offerKey(base);
    expect(offerKey({ ...base, cabin: "business" })).not.toBe(key);
    expect(offerKey({ ...base, fareClass: "M" })).not.toBe(key);
    expect(offerKey({ ...base, baggage: ["checked-20kg"] })).not.toBe(key);
    expect(offerKey({ ...base, refund: "refundable" })).not.toBe(key);
    expect(offerKey({ ...base, ticketType: "charter" })).not.toBe(key);
    expect(offerKey({ ...base, departDate: "2026-11-21" })).not.toBe(key);
    expect(offerKey({ ...base, originAirport: "THR" })).not.toBe(key);
    expect(offerKey({ ...base, airlineCode: "W5" })).not.toBe(key);
  });

  it("treats unknown facts as unknown, not as wildcards", () => {
    const unknown = offerKey({ ...base, baggage: [], refund: "unknown" });
    expect(unknown).toContain("bag:?");
    expect(unknown).toContain("ref:unknown");
    // An unknown-baggage offer must not collide with a known 30kg one.
    expect(unknown).not.toBe(offerKey(base));
  });

  it("is insensitive to baggage token order and flight-number formatting", () => {
    expect(offerKey({ ...base, baggage: ["checked-30kg", "cabin-7kg"] })).toBe(
      offerKey({ ...base, baggage: ["cabin-7kg", "checked-30kg"] }),
    );
    expect(offerKey({ ...base, flightNumber: "ir452" })).toBe(offerKey(base));
  });
});

describe("displayGroupKey", () => {
  it("groups the same flight regardless of fare conditions", () => {
    const a = displayGroupKey({ ...base, flightNumber: "IR-452" });
    const b = displayGroupKey({ ...base, flightNumber: "IR 452" });
    expect(a).toBe(b);
  });

  it("marks number-less offers so they can never merge with a numbered one", () => {
    const key = displayGroupKey({ ...base, flightNumber: null });
    expect(key).toContain("|~|");
  });
});

describe("deterministic ids", () => {
  it("derives the same id from the same product, without a raw provider id", () => {
    const id1 = deterministicOfferId("sepehr360", offerKey(base));
    const id2 = deterministicOfferId("sepehr360", offerKey({ ...base }));
    expect(id1).toBe(id2);
    expect(id1.startsWith("sepehr360:")).toBe(true);
  });

  it("keeps providers apart", () => {
    expect(deterministicOfferId("a", "k")).not.toBe(deterministicOfferId("b", "k"));
  });

  it("short-hashes are stable and 8 hex chars", () => {
    expect(shortHash("abc")).toMatch(/^[0-9a-f]{8}$/);
    expect(shortHash("abc")).toBe(shortHash("abc"));
    expect(shortHash("abc")).not.toBe(shortHash("abd"));
  });

  it("route keys are city-pair strings", () => {
    expect(routeKey("THR", "MHD")).toBe("THR>MHD");
  });
});
