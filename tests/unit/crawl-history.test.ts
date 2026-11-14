import { describe, expect, it } from "vitest";
import type { FlightOffer } from "@/domain/flight";
import { recordCrawlPriceHistory } from "@/modules/persistence/crawl-history";
import type { TransactionCapable } from "@/modules/db/transaction";

function quote(providerId: string, toman = 5_000_000): FlightOffer {
  return {
    id: `${providerId}:record`, groupKey: "IR|452|2026-11-13|THR>MHD", providerId, providerName: providerId,
    airlineCode: "IR", airlineName: "Iran Air", flightNumber: "452", originAirport: "THR", destinationAirport: "MHD",
    originCode: "THR", destinationCode: "MHD", departAt: "2026-11-13T04:00:00.000Z", arriveAt: "2026-11-13T05:20:00.000Z",
    durationMinutes: 80, stops: 0,
    segments: [{ airlineCode: "IR", flightNumber: "452", originCode: "THR", destinationCode: "MHD", departAt: "2026-11-13T04:00:00.000Z", arriveAt: "2026-11-13T05:20:00.000Z", aircraft: null }],
    price: { original: { amount: toman * 10, currency: "IRR" }, toman, converted: true },
    baggage: { checked: "unknown", checkedKg: null, cabinKg: null }, refundable: null, cabin: "economy", offerUrl: "",
    providerUpdatedAt: "2026-11-12T10:00:00.000Z", fetchedAt: "2026-11-12T10:00:00.000Z", dataSource: "crawled", warnings: [],
    fare: { cabin: "economy", fareClass: null, ticketType: "unknown", fareName: null }, freshness: "unverified",
  };
}

function fakeClient() {
  const observations: Array<Record<string, unknown>> = [];
  const tx = {
    priceObservation: {
      async findFirst({ where }: { where: { providerId: string; offerKey: string } }) {
        return observations.filter((row) => row.providerId === where.providerId && row.offerKey === where.offerKey)
          .sort((a, b) => (b.observedAt as Date).getTime() - (a.observedAt as Date).getTime())[0] as { priceToman: bigint; observedAt: Date } | undefined ?? null;
      },
      async create({ data }: { data: Record<string, unknown> }) { observations.push(data); return data; },
    },
  };
  const client = { async $transaction<T>(run: (transaction: Record<string, unknown>) => Promise<T>): Promise<T> { return run(tx); } } as unknown as TransactionCapable;
  return { observations, client };
}

describe("crawl price history persistence", () => {
  it("uses independent seller/fare identity and appends an hourly heartbeat or price change", async () => {
    const { client, observations } = fakeClient();
    const firstTime = new Date("2026-11-12T10:00:00Z");
    expect(await recordCrawlPriceHistory([quote("seller-a"), quote("seller-b")], { client, observedAt: firstTime })).toBe(2);
    expect(await recordCrawlPriceHistory([quote("seller-a"), quote("seller-b")], {
      client, observedAt: new Date("2026-11-12T10:59:59Z"),
    })).toBe(0);
    expect(await recordCrawlPriceHistory([quote("seller-a"), quote("seller-b")], {
      client, observedAt: new Date("2026-11-12T11:00:00Z"),
    })).toBe(2);
    expect(await recordCrawlPriceHistory([quote("seller-a", 4_900_000)], {
      client, observedAt: new Date("2026-11-12T11:01:00Z"),
    })).toBe(1);

    expect(observations).toHaveLength(5);
    expect(observations.map((row) => row.providerId)).toEqual(["seller-a", "seller-b", "seller-a", "seller-b", "seller-a"]);
    expect(observations.map((row) => row.currency)).toEqual(Array(5).fill("IRR"));
    expect(observations.map((row) => row.priceToman)).toEqual([5_000_000n, 5_000_000n, 5_000_000n, 5_000_000n, 4_900_000n]);
  });
});
