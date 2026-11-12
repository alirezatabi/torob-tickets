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
function withStubbedFetch(
  routes: { robots?: string; search?: { body: string; status?: number } },
) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/robots.txt")) {
        return new Response(routes.robots ?? "User-agent: *\nDisallow: /systemuser", { status: 200 });
      }
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
