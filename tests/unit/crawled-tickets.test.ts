import { describe, expect, it } from "vitest";
import type { RawOffer } from "@/crawler/types";
import { groupCrawledTickets } from "@/crawler/tickets";

function offer(id: string, flightNumber: string | null): RawOffer {
  return { id, origin: "THR", destination: "MHD", departAt: null, arriveAt: null, airline: null, flightNumber, amount: null, currency: "IRT", seats: null, offerUrl: null };
}

describe("crawled ticket grouping", () => {
  it("treats each exact flight code as one ticket and groups seller quotes for it", () => {
    const grouped = groupCrawledTickets([
      offer("offer-a", "FP7438"),
      offer("offer-b", "FP7438"),
      offer("offer-c", "IR530"),
    ]);
    expect(grouped).toHaveLength(2);
    expect(grouped.map((ticket) => [ticket.code, ticket.offers.length])).toEqual([["FP7438", 2], ["IR530", 1]]);
  });

  it("keeps records without a flight code separate using their captured id", () => {
    const grouped = groupCrawledTickets([offer("raw-a", null), offer("raw-b", null)]);
    expect(grouped.map((ticket) => ticket.code)).toEqual(["raw-a", "raw-b"]);
    expect(grouped[0]?.key).not.toBe(grouped[1]?.key);
  });
});
