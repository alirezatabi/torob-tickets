import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CrawlHttpClient } from "@/crawler/http";
import { writeSnapshot, readSnapshot } from "@/crawler/store";
import { CRAWL_SOURCES } from "@/crawler/sources";
import { safarmarketSource } from "@/crawler/sources/safarmarket";
import { normalizeRawOffers } from "@/crawler/normalize";
import { runSource } from "@/crawler/run";

describe("crawl source placeholders", () => {
  it("keeps the four sources without real captures explicitly blocked", () => {
    for (const source of CRAWL_SOURCES.filter((item) => item.id !== "safarmarket")) {
      expect(() => source.buildRequests({ originCode: "THR", destinationCode: "MHD", departDate: "2026-12-01", passengers: 1, cabin: "economy" })).toThrow("NOT_IMPLEMENTED: نیاز به fixture واقعی");
      expect(() => source.parseRaw("<html></html>", { route: "THR-MHD", date: "2026-12-01", url: source.origin })).toThrow("NOT_IMPLEMENTED: نیاز به fixture واقعی");
    }
  });

  it("parses only evidenced Safarmarket provider facts from the sanitized response fixture", async () => {
    const fixture = await readFile(join(process.cwd(), "tests/fixtures/crawl/safarmarket/THR-MHD-2026-11-22.json"), "utf8");
    const offers = safarmarketSource.parseRaw(fixture, { route: "THR-MHD", date: "2026-11-22", url: "https://safarmarket.com/api/flight/v3/search" });
    expect(offers).toHaveLength(3);
    expect(offers.map((offer) => offer.amount)).toEqual([81_840_000, 82_568_798, 82_896_000]);
    expect(offers[0]).toMatchObject({ origin: "THR", destination: "MHD", airline: "Fly Persia", airlineCode: "FP", flightNumber: "FP7438", departAt: null, arriveAt: null, departureLocal: "2026-11-22 14:20", arrivalLocal: "2026-11-22 15:40", amount: 81_840_000, currency: null, seats: 9, offerUrl: null, providerId: "faza24", flightClass: "ECONOMY", sellType: "CHARTER", aircraft: "Boeing", charter: true });
    expect(normalizeRawOffers(offers)[0]?.warnings).toEqual(expect.arrayContaining(["currency-missing", "timezone-unresolved"]));
    expect(safarmarketSource.parseRaw(fixture, { route: "IKA-MHD", date: "2026-11-22", url: "" })).toEqual([]);
    expect(safarmarketSource.parseRaw(fixture, { route: "THR-MHD", date: "2026-11-23", url: "" })).toEqual([]);
  });

  it("keeps Safarmarket blocked rather than replaying session-bound or challenge fields", () => {
    const request = safarmarketSource.buildRequests({ originCode: "THR", destinationCode: "MHD", departDate: "2026-11-22", passengers: 1, cabin: "economy" })[0];
    expect(request).toMatchObject({ url: "https://safarmarket.com/api/flight/v3/search", method: "POST", body: null });
    expect(request?.blockedReason).toContain("credential/challenge replay is unsupported");
  });

  it("does not send a Safarmarket request that requires replaying browser credentials or a challenge", async () => {
    const fetcher = vi.fn(async () => new Response("should not be called"));
    const client = new CrawlHttpClient({ fetch: fetcher, sleep: async () => undefined });
    await expect(runSource(safarmarketSource, { originCode: "THR", destinationCode: "MHD", departDate: "2026-11-22", passengers: 1, cabin: "economy" }, { client, enabled: true })).rejects.toThrow("credential/challenge replay is unsupported");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps absent Safarmarket facts null", () => {
    const body = JSON.stringify({ code: 200, result: { flights: [{ flightId: "flight-x", leave: {}, providers: [{ price: 1200 }] }] } });
    const offers = safarmarketSource.parseRaw(body, { route: "", date: "", url: "" });
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ id: "flight-x", origin: null, destination: null, departAt: null, arriveAt: null, airline: null, flightNumber: null, currency: null, seats: null, offerUrl: null });
  });
});

describe("crawler HTTP safeguards", () => {
  it("checks robots first and rejects a disallowed path without requesting it", async () => {
    const fetcher = vi.fn(async (input: string | URL) => new Response(String(input).endsWith("robots.txt") ? "User-agent: *\nDisallow: /private" : "should not happen"));
    const client = new CrawlHttpClient({ fetch: fetcher, sleep: async () => undefined });
    await expect(client.get("https://example.test/private/flight")).rejects.toMatchObject({ code: "ROBOTS_DISALLOWED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails closed when robots.txt is unavailable", async () => {
    const fetcher = vi.fn(async () => new Response("unavailable", { status: 503 }));
    const client = new CrawlHttpClient({ fetch: fetcher, sleep: async () => undefined, maxAttempts: 1 });
    await expect(client.get("https://example.test/flights")).rejects.toMatchObject({ code: "ROBOTS_UNAVAILABLE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("stops on a detected challenge without retrying", async () => {
    let calls = 0;
    const fetcher = vi.fn(async (input: string | URL) => {
      calls += 1;
      return new Response(String(input).endsWith("robots.txt") ? "User-agent: *\nAllow: /" : "Please complete the CAPTCHA");
    });
    const client = new CrawlHttpClient({ fetch: fetcher, sleep: async () => undefined });
    await expect(client.get("https://example.test/flights")).rejects.toMatchObject({ code: "CHALLENGE_DETECTED" });
    expect(calls).toBe(2);
  });

  it("honors Retry-After on transient server errors", async () => {
    let attempts = 0;
    const sleeps: number[] = [];
    const fetcher = vi.fn(async (input: string | URL) => {
      if (String(input).endsWith("robots.txt")) return new Response("User-agent: *\nAllow: /");
      attempts += 1;
      return attempts === 1 ? new Response("busy", { status: 503, headers: { "retry-after": "4" } }) : new Response("ok");
    });
    const client = new CrawlHttpClient({ fetch: fetcher, sleep: async (ms) => { sleeps.push(ms); } });
    const response = await client.get("https://example.test/flights");
    expect(response.status).toBe(200);
    expect(sleeps).toContain(4000);
    expect(attempts).toBe(2);
  });

  it("checks robots.txt on a redirect target before following it", async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "example.test" && url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /");
      if (url.hostname === "example.test") return new Response(null, { status: 302, headers: { location: "https://other.test/secret" } });
      if (url.hostname === "other.test" && url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /");
      return new Response("must not fetch");
    });
    const client = new CrawlHttpClient({ fetch: fetcher, sleep: async () => undefined });
    await expect(client.get("https://example.test/start")).rejects.toMatchObject({ code: "ROBOTS_DISALLOWED" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("enforces the request ceiling including robots.txt", async () => {
    const fetcher = vi.fn(async () => new Response("User-agent: *\nAllow: /"));
    const client = new CrawlHttpClient({ fetch: fetcher, sleep: async () => undefined, maxRequests: 1 });
    await expect(client.get("https://example.test/flights")).rejects.toMatchObject({ code: "REQUEST_LIMIT" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("uses injected fetch and emits transparent user agent", async () => {
    let requestHeaders: HeadersInit | undefined;
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      requestHeaders = init?.headers;
      return String(input).endsWith("robots.txt") ? new Response("User-agent: *\nAllow: /") : new Response("ok");
    });
    const client = new CrawlHttpClient({ fetch: fetcher, sleep: async () => undefined });
    await client.get("https://example.test/flights");
    expect(requestHeaders).toMatchObject({ "user-agent": expect.stringContaining("TorobTicketsResearchBot") });
  });
});

describe("crawled raw normalization and storage guard", () => {
  it("preserves unknowns as null and marks bad facts without inventing conversions", () => {
    const row = { id: null, origin: null, destination: null, departAt: "not-a-date", arriveAt: null, airline: null, flightNumber: null, amount: -4, currency: null, seats: null, offerUrl: null };
    const normalized = normalizeRawOffers([row])[0]!;
    expect(normalized.amount).toBe(-4);
    expect(normalized.currency).toBeNull();
    expect(normalized.warnings).toEqual(expect.arrayContaining(["invalid-price", "currency-missing", "invalid-departure-time"]));
  });

  it("refuses synthetic snapshots and reads only real local snapshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "crawl-test-"));
    try {
      const synthetic = { schemaVersion: 1 as const, source: "synthetic-test", fetchedAt: new Date(0).toISOString(), route: "THR-MHD", date: "2026-12-01", offers: [] };
      await expect(writeSnapshot(synthetic, root)).rejects.toThrow("Refusing to store synthetic-test");
      expect(await readSnapshot("synthetic-test", root)).toBeNull();
      const real = { ...synthetic, source: "fixture-real" };
      const outputPath = await writeSnapshot(real, root);
      expect((await readSnapshot("fixture-real", root))?.source).toBe("fixture-real");
      expect(outputPath).toBe(join(root, "latest.json"));
      const latest = JSON.parse(await readFile(outputPath, "utf8")) as { snapshots: { source: string }[] };
      expect(latest.snapshots.map((item) => item.source)).toEqual(["fixture-real"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
