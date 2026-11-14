import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES } from "@/domain/trip";
import { offerMatchesFilters, timeRangeMatches } from "@/lib/filter";
import { assembleOffer } from "@/providers/normalize";

function offer(departAt: string) {
  return assembleOffer({
    providerId: "test", providerName: "test", rawId: departAt,
    airlineCode: "FP", flightNumber: "FP7438",
    segments: [{
      airlineCode: "FP", flightNumber: "FP7438", originCode: "THR", destinationCode: "MHD",
      departAt, arriveAt: new Date(new Date(departAt).getTime() + 80 * 60_000).toISOString(), aircraft: null,
    }],
    price: { amount: 10_000_000, currency: "IRR" },
    baggage: { checked: "unknown", cabinKg: null, checkedKg: null }, refundable: null,
    cabin: "economy", offerUrl: "", providerUpdatedAt: departAt, fetchedAt: departAt, dataSource: "crawled",
  });
}

describe("departure-time filtering", () => {
  it("filters by an inclusive clock-time window at the origin on the selected day", () => {
    const filters = { ...DEFAULT_PREFERENCES, departureTimeFrom: "14:00", departureTimeTo: "15:00" };
    expect(offerMatchesFilters(offer("2026-11-22T10:50:00.000Z"), filters)).toBe(true); // 14:20 Tehran
    expect(offerMatchesFilters(offer("2026-11-22T11:30:00.000Z"), filters)).toBe(true); // 15:00 Tehran
    expect(offerMatchesFilters(offer("2026-11-22T11:31:00.000Z"), filters)).toBe(false);
  });

  it("supports one-sided and cross-midnight ranges", () => {
    expect(timeRangeMatches("08:30", "08:00", null)).toBe(true);
    expect(timeRangeMatches("07:59", "08:00", null)).toBe(false);
    expect(timeRangeMatches("23:30", "22:00", "02:00")).toBe(true);
    expect(timeRangeMatches("01:30", "22:00", "02:00")).toBe(true);
    expect(timeRangeMatches("12:00", "22:00", "02:00")).toBe(false);
  });
});
