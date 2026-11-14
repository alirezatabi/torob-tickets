import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES } from "@/domain/trip";
import { groupOffers } from "@/dedupe/group";
import { filterGroups } from "@/lib/filter";
import { runSearch } from "@/providers/search";
import { viewFromOutcome } from "@/server/search-service";
import { safarmarketSource } from "@/crawler/sources/safarmarket";
import { safarmarketSnapshotAdapter } from "@/providers/crawled/safarmarket";

describe("crawled offers in the shared search model", () => {
  it("normalizes fixture quotes into one flight code with seller-specific IRT prices", async () => {
    const fixture = await readFile(join(process.cwd(), "tests/fixtures/crawl/safarmarket/THR-MHD-2026-11-22.json"), "utf8");
    const raw = safarmarketSource.parseRaw(fixture, { route: "THR-MHD", date: "2026-11-22", url: "" });
    const normalized = safarmarketSnapshotAdapter.normalize(raw.map((offer) => ({ raw: offer, fetchedAt: "2026-11-14T14:12:00.000Z" })), {
      originCode: "THR", destinationCode: "MHD", departDate: "2026-11-22", passengers: 1,
      cabin: "economy", mode: "flight", tripType: "oneway", returnDate: null, filters: { ...DEFAULT_PREFERENCES },
    });

    expect(normalized.issues).toEqual([]);
    expect(normalized.offers).toHaveLength(3);
    expect(normalized.offers.every((offer) => offer.dataSource === "crawled" && offer.price.original.currency === "IRT" && offer.price.toman === offer.price.original.amount)).toBe(true);
    expect(normalized.offers.map((offer) => offer.flightNumber)).toEqual(["FP7438", "FP7438", "FP7438"]);
    expect(normalized.offers[0]?.segments[0]?.departAt).toBe("2026-11-22T10:50:00.000Z");
    expect(normalized.offers[0]?.warnings).toEqual(expect.arrayContaining(["currency-assumed", "timezone-assumed"]));
    expect(groupOffers(normalized.offers)).toHaveLength(1);
    expect(groupOffers(normalized.offers)[0]?.offers).toHaveLength(3);
  });

  it("runs fixture quotes through the ordinary search and flight-result view", async () => {
    const fixture = await readFile(join(process.cwd(), "tests/fixtures/crawl/safarmarket/THR-MHD-2026-11-22.json"), "utf8");
    const raw = safarmarketSource.parseRaw(fixture, { route: "THR-MHD", date: "2026-11-22", url: "" });
    const records = raw.map((offer) => ({ raw: offer, fetchedAt: "2026-11-14T14:12:00.000Z" }));
    const query = {
      originCode: "THR", destinationCode: "MHD", departDate: "2026-11-22", passengers: 1,
      cabin: "economy" as const, mode: "flight" as const, tripType: "oneway" as const, returnDate: null,
      filters: { ...DEFAULT_PREFERENCES, dataSource: "real" as const },
    };
    const localAdapter = { ...safarmarketSnapshotAdapter, search: async () => records };
    const outcome = await runSearch(query, {
      now: new Date("2026-11-14T00:00:00.000Z"), providers: [localAdapter], includeCrawled: true,
    });
    const view = viewFromOutcome(outcome, query, "cheapest");

    expect(outcome.health.map((provider) => provider.mode)).toEqual(["crawled"]);
    expect(outcome.offers).toHaveLength(3);
    expect(view.flights).toHaveLength(1);
    expect(view.flights[0]?.group.offers).toHaveLength(3);
    expect(view.flights[0]?.sellers).toHaveLength(3);
    expect(view.flights[0]?.group.groupKey).toContain("|crawled");
  });

  it("keeps sample and real tickets distinct and honors the source filter", async () => {
    const fixture = await readFile(join(process.cwd(), "tests/fixtures/crawl/safarmarket/THR-MHD-2026-11-22.json"), "utf8");
    const raw = safarmarketSource.parseRaw(fixture, { route: "THR-MHD", date: "2026-11-22", url: "" });
    const real = safarmarketSnapshotAdapter.normalize(raw.map((offer) => ({ raw: offer, fetchedAt: "2026-11-14T14:12:00.000Z" })), {
      originCode: "THR", destinationCode: "MHD", departDate: "2026-11-22", passengers: 1,
      cabin: "economy", mode: "flight", tripType: "oneway", returnDate: null, filters: { ...DEFAULT_PREFERENCES },
    }).offers;
    const demo = { ...real[0]!, id: "demo-copy", dataSource: "demo" as const, providerId: "demo-copy" };
    const groups = groupOffers([...real, demo]);
    expect(groups).toHaveLength(2);
    expect(filterGroups(groups, { ...DEFAULT_PREFERENCES, dataSource: "real" }).visible.every((group) => group.primary.dataSource === "crawled")).toBe(true);
    expect(filterGroups(groups, { ...DEFAULT_PREFERENCES, dataSource: "demo" }).visible.every((group) => group.primary.dataSource === "demo")).toBe(true);
  });
});
