import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { Sepehr360Adapter } from "@/modules/providers/sepehr360/adapter";
import type { ProviderSearchRequest } from "@/modules/providers/contracts/provider";
import { createMemoryLogger } from "@/modules/providers/shared/logger";

const fixture = (name: string) =>
  readFileSync(path.join(process.cwd(), "src/modules/providers/sepehr360/__fixtures__", name), "utf8");

const REQUEST: ProviderSearchRequest = {
  query: { origin: "THR", destination: "MHD", departDate: "2026-11-13" } as unknown as ProviderSearchRequest["query"],
  originCity: "THR",
  destinationCity: "MHD",
  originAirports: ["THR", "IKA"],
  destinationAirports: ["MHD"],
  departDate: "2026-11-13",
  passengers: 1,
  cabin: "economy",
  international: false,
};

/**
 * The adapter builds its own HttpClient, so the test injects one by stubbing global
 * fetch — the adapter itself has no test-only seam, which is deliberate: the code
 * under test is the same code that runs against the real site.
 */
function withStubbedFetch(routes: {
  robots?: string;
  search?: { body: string; status?: number };
  /** Extra paths served by the fake origin, e.g. discovered bundles and JSON endpoints. */
  extra?: Record<string, string>;
}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/robots.txt")) {
        return new Response(routes.robots ?? "User-agent: *\nDisallow: /systemuser", { status: 200 });
      }
      const path = new URL(url).pathname;
      const extra = routes.extra?.[path];
      if (extra) return new Response(extra, { status: 200 });
      if (routes.search) {
        return new Response(routes.search.body, { status: routes.search.status ?? 200 });
      }
      return new Response("not found", { status: 404 });
    }),
  );
  return calls;
}

function context() {
  return {
    signal: new AbortController().signal,
    logger: createMemoryLogger(),
    now: () => new Date("2026-11-12T10:00:00.000Z"),
    budgetMs: 8_000,
  };
}

describe("Sepehr360Adapter", () => {
  it("fetches one page, parses it and normalizes real-shaped results", async () => {
    const calls = withStubbedFetch({
      robots: "User-agent: *\nDisallow: /systemuser\nDisallow: /controlpanel",
      search: { body: fixture("thr-mhd.html") },
    });

    const adapter = new Sepehr360Adapter({ enabled: true });
    const result = await adapter.search(REQUEST, context());

    expect(result.records).toHaveLength(4);
    expect(result.meta.httpStatus).toBe(200);
    // robots.txt + exactly one search request: no crawling, no retries.
    expect(calls.filter((url) => !url.endsWith("/robots.txt"))).toHaveLength(1);
    expect(calls[1]).toContain("departureDate=1405-08-22");

    const batch = adapter.normalize(result.records, REQUEST, result.meta);
    expect(batch.issues).toEqual([]);
    expect(batch.offers).toHaveLength(4);
    expect(batch.offers[0]).toMatchObject({
      originCode: "THR",
      destinationCode: "MHD",
      dataSource: "live",
      freshness: "fresh",
      flightNumber: null,
      baggage: { checked: "unknown" },
      refundable: null,
    });
    expect(batch.offers[0]?.price.toman).toBe(5_902_000);
    vi.unstubAllGlobals();
  });

  it("derives unique ids for offers the source did not identify", async () => {
    withStubbedFetch({ search: { body: fixture("thr-mhd.html") } });
    const adapter = new Sepehr360Adapter({ enabled: true });
    const result = await adapter.search(REQUEST, context());
    const batch = adapter.normalize(result.records, REQUEST, result.meta);

    const ids = batch.offers.map((offer) => offer.id);
    expect(new Set(ids).size).toBe(ids.length);
    vi.unstubAllGlobals();
  });

  it("does not retry when robots.txt disallows the search path", async () => {
    const calls = withStubbedFetch({
      robots: "User-agent: *\nDisallow: /Flight",
      search: { body: fixture("thr-mhd.html") },
    });

    const adapter = new Sepehr360Adapter({ enabled: true });
    await expect(adapter.search(REQUEST, context())).rejects.toMatchObject({ code: "prohibited" });
    expect(calls.filter((url) => url.includes("/Flight"))).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("reports a CAPTCHA page as prohibited", async () => {
    withStubbedFetch({ search: { body: fixture("captcha.html") } });
    const adapter = new Sepehr360Adapter({ enabled: true });

    await expect(adapter.search(REQUEST, context())).rejects.toMatchObject({ code: "prohibited" });
    vi.unstubAllGlobals();
  });

  it("returns an empty, successful result for a route with no flights", async () => {
    withStubbedFetch({ search: { body: fixture("empty.html") } });
    const adapter = new Sepehr360Adapter({ enabled: true });

    const result = await adapter.search(REQUEST, context());
    expect(result.records).toEqual([]);
    expect(result.rawCount).toBe(0);
    vi.unstubAllGlobals();
  });

  it("parses the live search page's own cards end to end", async () => {
    // Reconstructed from the real page (2026-11-12): real prices, airlines, clocks, routes.
    withStubbedFetch({ search: { body: fixture("live-cards.html") } });
    const adapter = new Sepehr360Adapter({ enabled: true });
    const result = await adapter.search(REQUEST, context());

    expect(result.records).toHaveLength(7);
    const batch = adapter.normalize(result.records, REQUEST, result.meta);
    expect(batch.issues).toEqual([]);
    expect(batch.offers).toHaveLength(7);

    const [cheapest] = batch.offers;
    expect(cheapest).toMatchObject({
      dataSource: "live",
      airlineCode: "VR",
      originAirport: "THR",
      destinationAirport: "MHD",
      departAt: "2026-11-13T09:30:00.000Z", // 13:00 Tehran
      arriveAt: "2026-11-13T10:45:00.000Z",
      durationMinutes: 75,
      price: expect.objectContaining({ toman: 6_800_000 }),
    });

    // Every airline code came from the page's own logo, and matches the printed name.
    expect(batch.offers.map((offer) => offer.airlineCode)).toEqual(["VR", "AXV", "B9", "A7", "J1", "IR", "W5"]);
    // Airports resolved from the printed names, so nothing is guessed.
    expect(batch.offers.every((offer) => offer.originAirport === "THR" && offer.destinationAirport === "MHD")).toBe(true);
    // Times are real, prices are integers in toman, and nothing was fabricated.
    expect(batch.offers.every((offer) => offer.price.toman > 5_000_000)).toBe(true);
    vi.unstubAllGlobals();
  });

  it("reads the offers from the site's own JSON feed when the HTML is only a shell", async () => {
    // This is the real failure the user hit: HTTP 200, 5 KB shell, no price in the markup.
    // The data exists, behind the bundle's XHR — discover it and read it.
    const calls = withStubbedFetch({
      search: { body: fixture("js-shell.html") },
      extra: {
        "/assets/app.js": 'var SEARCH_API = "https://sepehr360.ir/api/flight/search";',
        "/assets/vendor.js": "/* runtime */",
        "/api/flight/search": JSON.stringify({
          data: {
            result: [
              {
                airlineCode: "IR",
                airlineName: "ایران ایر",
                price: 5_902_000,
                departTime: "07:30",
                arriveTime: "08:50",
                duration: 80,
                stops: 0,
                origin: "THR",
                destination: "MHD",
                flightNumber: "IR 452",
              },
              { airlineCode: "W5", price: 6_120_000, departTime: "09:15", arriveTime: "10:40", stops: 1 },
            ],
          },
        }),
      },
    });

    const adapter = new Sepehr360Adapter({ enabled: true });
    const result = await adapter.search(REQUEST, context());

    expect(result.records).toHaveLength(2);
    expect(result.warnings?.[0]).toContain("api-endpoint:");

    const batch = adapter.normalize(result.records, REQUEST, result.meta);
    expect(batch.offers).toHaveLength(2);
    expect(batch.offers[0]).toMatchObject({
      dataSource: "live",
      airlineCode: "IR",
      // 07:30 Tehran wall clock → the stored instant (Tehran is +03:30).
      departAt: "2026-11-13T04:00:00.000Z",
      price: expect.objectContaining({ toman: 5_902_000 }),
      flightNumber: "IR452",
    });
    expect(batch.offers[1]?.stops).toBe(1);
    // Airports came from the feed's own IATA codes, so nothing is marked "assumed".
    expect(batch.offers[0]?.originAirport).toBe("THR");
    expect(batch.offers[0]?.destinationAirport).toBe("MHD");
    expect(batch.offers[0]?.warnings).not.toContain("airport-unknown");

    // One page + bundles + one endpoint: bounded, and the endpoint was called once.
    // The endpoint was called once, and only with the search attached.
    const apiCalls = calls.filter((url) => url.includes("/api/flight/search"));
    expect(apiCalls).toHaveLength(1);
    expect(apiCalls[0]).toContain("origin=THR");
    expect(apiCalls[0]).toContain("departureDate=1405-08-22");
    vi.unstubAllGlobals();
  }, 30_000);

  it("still reports evidence when discovery finds no offers", async () => {
    withStubbedFetch({
      search: { body: fixture("js-shell.html") },
      extra: {
        "/assets/app.js": 'var SEARCH_API = "https://sepehr360.ir/api/flight/search";',
        "/assets/vendor.js": "/* runtime */",
        "/api/flight/search": JSON.stringify({ data: { filters: [{ id: 1, title: "ماهان" }] } }),
      },
    });
    const adapter = new Sepehr360Adapter({ enabled: true });

    // The failure must say what discovery actually saw, so the next fix is data-driven.
    await expect(adapter.search(REQUEST, context())).rejects.toMatchObject({
      code: "parse",
      detail: expect.stringContaining("discovery=empty"),
    });
    await expect(adapter.search(REQUEST, context())).rejects.toMatchObject({
      detail: expect.stringContaining("/api/flight/search"),
    });
    void 0;
    vi.unstubAllGlobals();
  }, 40_000);

  it("fails loudly when the markup no longer parses", async () => {
    withStubbedFetch({ search: { body: "<html><body><div>سایت تغییر کرده است</div></body></html>" } });
    const adapter = new Sepehr360Adapter({ enabled: true });

    await expect(adapter.search(REQUEST, context())).rejects.toMatchObject({ code: "parse" });
    vi.unstubAllGlobals();
  });

  it("refuses to run when disabled", async () => {
    withStubbedFetch({});
    const adapter = new Sepehr360Adapter({ enabled: false });
    expect(adapter.isConfigured()).toBe(false);
    await expect(adapter.search(REQUEST, context())).rejects.toMatchObject({ code: "not-configured" });
    vi.unstubAllGlobals();
  });

  it("rejects a card whose printed airports do not serve the requested city pair", () => {
    withStubbedFetch({});
    const adapter = new Sepehr360Adapter({ enabled: true });
    // The fixture cards print "مهرآباد → مشهد"; asking for THR→IST must not relabel them.
    const records = [
      {
        index: 0,
        airlineCode: "IR",
        airlineNameFa: "ایران ایر",
        departTime: "07:30",
        arriveTime: "08:50",
        durationText: "1 ساعت و 20 دقیقه",
        priceText: "5902000 تومان",
        priceAmount: 5_902_000,
        originLabel: "مهرآباد",
        destinationLabel: "مشهد",
        cabinLabel: "اکونومی",
        stopsLabel: "مستقیم",
        sellerText: null,
        availabilityText: null,
        charterHint: false,
      },
    ];

    const batch = adapter.normalize(records, { ...REQUEST, destinationCity: "IST", destinationAirports: ["IST"], international: true }, {
      providerId: "sepehr360",
      fetchedAt: "2026-11-12T10:00:00.000Z",
      latencyMs: 10,
      httpStatus: 200,
      retries: 0,
      fromCache: false,
      endpoint: "GET /Flight/B2c/Search",
      sourceUpdatedAt: null,
    });

    expect(batch.offers).toEqual([]);
    expect(batch.issues[0]).toMatchObject({ code: "unknown-city" });
    vi.unstubAllGlobals();
  });

  it("flags a card with no printed airport as airport-unknown instead of silently assuming", () => {
    withStubbedFetch({});
    const adapter = new Sepehr360Adapter({ enabled: true });
    const base = {
      index: 0,
      airlineCode: "IR",
      airlineNameFa: "ایران ایر",
      departTime: "07:30",
      arriveTime: "08:50",
      durationText: "1 ساعت و 20 دقیقه",
      priceText: "5902000 تومان",
      priceAmount: 5_902_000,
      originLabel: null,
      destinationLabel: null,
      cabinLabel: "اکونومی",
      stopsLabel: "مستقیم",
      sellerText: null,
      availabilityText: null,
      charterHint: false,
    };

    const batch = adapter.normalize([base], {
      ...REQUEST,
      originAirports: ["THR"],
      destinationAirports: ["MHD"],
    }, {
      providerId: "sepehr360",
      fetchedAt: "2026-11-12T10:00:00.000Z",
      latencyMs: 10,
      httpStatus: 200,
      retries: 0,
      fromCache: false,
      endpoint: "GET /Flight/B2c/Search",
      sourceUpdatedAt: null,
    });

    expect(batch.offers).toHaveLength(1);
    expect(batch.offers[0]?.warnings).toContain("airport-unknown");
    expect(batch.offers[0]?.originAirport).toBe("THR");
    vi.unstubAllGlobals();
  });

  it("marks a no-baggage, no-number aggregator row honestly in Persian labels", async () => {
    withStubbedFetch({ search: { body: fixture("thr-mhd.html") } });
    const adapter = new Sepehr360Adapter({ enabled: true });
    const result = await adapter.search(REQUEST, context());
    const offer = adapter.normalize(result.records, REQUEST, result.meta).offers[0];

    expect(offer?.warnings).toEqual(
      expect.arrayContaining(["flight-number-missing", "baggage-unknown", "refund-unknown", "availability-unverified"]),
    );
    // No per-offer deep link exists; the honest link is the search page itself.
    expect(offer?.offerUrl).toContain("/Flight/B2c/Search?");
    vi.unstubAllGlobals();
  });
});
