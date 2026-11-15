import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CrawlHttpClient } from "@/crawler/http";
import { writeSnapshot, readSnapshot, readSnapshotsForSources } from "@/crawler/store";
import { CRAWL_SOURCES } from "@/crawler/sources";
import { safarmarketSource } from "@/crawler/sources/safarmarket";
import { basisflySource } from "@/crawler/sources/basisfly";
import { normalizeRawOffers } from "@/crawler/normalize";
import { runSource } from "@/crawler/run";

describe("crawl source placeholders", () => {
  it("keeps the four sources without real captures explicitly blocked", () => {
    for (const source of CRAWL_SOURCES.filter((item) => item.id !== "safarmarket" && item.id !== "basisfly")) {
      expect(() => source.buildRequests({ originCode: "THR", destinationCode: "MHD", departDate: "2026-12-01", passengers: 1, cabin: "economy" })).toThrow("NOT_IMPLEMENTED: نیاز به fixture واقعی");
      expect(() => source.parseRaw("<html></html>", { route: "THR-MHD", date: "2026-12-01", url: source.origin })).toThrow("NOT_IMPLEMENTED: نیاز به fixture واقعی");
    }
  });

  it("parses only evidenced Safarmarket provider facts from the sanitized response fixture", async () => {
    const fixture = await readFile(join(process.cwd(), "tests/fixtures/crawl/safarmarket/THR-MHD-2026-11-22.json"), "utf8");
    const offers = safarmarketSource.parseRaw(fixture, { route: "THR-MHD", date: "2026-11-22", url: "https://safarmarket.com/api/flight/v3/search" });
    expect(offers).toHaveLength(3);
    expect(offers.map((offer) => offer.amount)).toEqual([81_840_000, 82_568_798, 82_896_000]);
    expect(offers[0]).toMatchObject({ origin: "THR", destination: "MHD", airline: "Fly Persia", airlineCode: "FP", flightNumber: "FP7438", departAt: "2026-11-22T10:50:00.000Z", arriveAt: "2026-11-22T12:10:00.000Z", departureLocal: "2026-11-22 14:20", arrivalLocal: "2026-11-22 15:40", amount: 81_840_000, currency: "IRR", seats: 9, offerUrl: null, providerId: "faza24", flightClass: "ECONOMY", sellType: "CHARTER", aircraft: "Boeing", charter: true });
    const warnings = normalizeRawOffers(offers)[0]?.warnings ?? [];
    expect(warnings).not.toContain("currency-missing");
    expect(warnings).not.toContain("timezone-unresolved");
    expect(safarmarketSource.parseRaw(fixture, { route: "IKA-MHD", date: "2026-11-22", url: "" })).toEqual([]);
    expect(safarmarketSource.parseRaw(fixture, { route: "THR-MHD", date: "2026-11-23", url: "" })).toEqual([]);
  });

  it("builds only the captured Safarmarket POST payload fields and nulls client-specific IPInfo", () => {
    const request = safarmarketSource.buildRequests({ originCode: "THR", destinationCode: "MHD", departDate: "2026-11-22", passengers: 1, cabin: "economy" })[0];
    expect(request).toMatchObject({ url: "https://safarmarket.com/api/flight/v3/search", method: "POST" });
    expect(JSON.parse(request!.body!)).toEqual({
      platform: "WEB_DESKTOP", uid: "", limit: 250, compress: false, productType: "LFLI", searchValidity: 2, cid: 1, checksum: 1, IPInfo: null,
      searchFilter: { sourceAirportCode: "THR", targetAirportCode: "MHD", sourceIsCity: true, targetIsCity: true, leaveDate: "2026-11-22", returnDate: "", adultCount: 1, childCount: 0, infantCount: 0, economy: true, business: true },
    });
    expect(request).not.toHaveProperty("headers");
  });

  it("parses Basisfly wrapped proposals conservatively, preserving source currency and unknown timezone", () => {
    const body = JSON.stringify([{ sources: [{ data: [{
      Locations: { "1211083": { Code: "MHD" }, "1203548": { Code: "THR" } },
      FlightProposals: [
        { FlightId: "opaque-a", PriceInfo: { Total: 119194000, Currency: "IRR" }, Provider: { Name: "Seller A" }, FlightGroup: [{
          GroupId: "fare-1", RoutesInfo: [
            { Origin: 1211083, Destination: 1203548, AirlineCode: "IR", FlightNumber: "IR452", DepartureDateTime: "2026-11-15T08:00:00+03:30", ArrivalDateTime: "2026-11-15T09:20:00+03:30" },
          ], Baggages: [{ PassengerType: "ADT", Pieces: 1, Weight: 20, Unit: "KG" }], AvailableSeats: 4,
        }] },
        { FlightId: "opaque-b", PriceInfo: { Total: 120000000, Currency: "IRR" }, FlightGroup: [{
          GroupId: "fare-2", RoutesInfo: [{ Origin: 1211083, Destination: 1203548, AirlineCode: "IR", FlightNumber: "IR452", DepartureTime: "2026-11-15 08:00", ArrivalTime: "2026-11-15 09:20" }],
        }] },
      ],
    }] }] }]);
    const offers = basisflySource.parseRaw(body, { route: "MHD-THR", date: "2026-11-15", url: basisflySource.origin });
    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({ id: "opaque-a:fare-1", origin: "MHD", destination: "THR", departAt: "2026-11-15T04:30:00.000Z", arriveAt: "2026-11-15T05:50:00.000Z", airlineCode: "IR", flightNumber: "IR452", amount: 119194000, currency: "IRR", seats: 4, offerUrl: null });
    expect(offers[0]?.sourceSegments).toHaveLength(1);
    expect((offers[0]?.sourceSegments as Array<{ departureLocal: string }>)[0]?.departureLocal).toBe("2026-11-15T08:00:00+03:30");
    expect(offers[1]?.departAt).toBeNull();
    expect(offers[1]?.currency).toBe("IRR");
    expect(basisflySource.parseRaw(body, { route: "IKA-THR", date: "2026-11-15", url: "" })).toEqual([]);
  });

  it("requires an operator-supplied Basisfly template and never includes a SessionId", () => {
    vi.stubEnv("BASISFLY_REQUEST_TEMPLATE", "");
    try {
      const request = basisflySource.buildRequests({ originCode: "MHD", destinationCode: "THR", departDate: "2026-11-15", passengers: 1, cabin: "economy" })[0];
      expect(request).toMatchObject({ url: "https://ota.basisfly.com/v2/api/flight/lazysearch", method: "POST", body: null });
      expect(request?.blockedReason).toMatch(/BASISFLY_REQUEST_TEMPLATE/);
      expect(JSON.stringify(request)).not.toMatch(/SessionId\s*[:=]/);
    } finally { vi.unstubAllEnvs(); }
  });

  it("fails closed when the private Basisfly header value is not configured", () => {
    vi.stubEnv("BASISFLY_REQUEST_TEMPLATE", JSON.stringify({
      Origin: "{{ORIGIN_ID}}", Destination: "{{DESTINATION_ID}}", Date: "{{DATE}}", Pax: "{{PASSENGERS}}",
    }));
    vi.stubEnv("SECRET_TOROB", "");
    try {
      const request = basisflySource.buildRequests({ originCode: "MHD", destinationCode: "THR", departDate: "2026-11-15", passengers: 1, cabin: "economy" })[0];
      expect(request?.body).toBeNull();
      expect(request?.headers).toBeUndefined();
      expect(request?.blockedReason).toMatch(/Set SECRET_TOROB/);
    } finally { vi.unstubAllEnvs(); }
  });

  it("substitutes only explicit Basisfly route/date/passenger placeholders and rejects credential fields", () => {
    vi.stubEnv("BASISFLY_REQUEST_TEMPLATE", JSON.stringify({
      command: "lazysearch", dmnid: 9, lid: 2,
      TripGroup: [{ Origin: "{{ORIGIN_ID}}", Destination: "{{DESTINATION_ID}}", Date: "{{DATE}}", Passengers: "{{PASSENGERS}}", Cabin: "{{CABIN}}" }],
    }));
    vi.stubEnv("SECRET_TOROB", "test-only-placeholder-secret");
    try {
      const request = basisflySource.buildRequests({ originCode: "MHD", destinationCode: "THR", departDate: "2026-11-15", passengers: 2, cabin: "economy" })[0];
      expect(JSON.parse(request!.body!)).toEqual({
        command: "lazysearch", dmnid: 9, lid: 2,
        TripGroup: [{ Origin: 1211083, Destination: 1203548, Date: "2026-11-15", Passengers: 2, Cabin: "economy" }],
      });
      expect(request!.body).not.toContain("SessionId");
    } finally { vi.unstubAllEnvs(); }

    vi.stubEnv("BASISFLY_REQUEST_TEMPLATE", JSON.stringify({ command: "lazysearch", SessionId: "" }));
    vi.stubEnv("SECRET_TOROB", "test-only-placeholder-secret");
    try {
      const blocked = basisflySource.buildRequests({ originCode: "MHD", destinationCode: "THR", departDate: "2026-11-15", passengers: 1, cabin: "economy" })[0];
      expect(blocked?.body).toBeNull();
      expect(blocked?.blockedReason).toMatch(/Remove credential-like field SessionId/);
    } finally { vi.unstubAllEnvs(); }
  });

  it("sends SECRET_TOROB only on the Basisfly POST, never on robots.txt", async () => {
    vi.stubEnv("BASISFLY_REQUEST_TEMPLATE", JSON.stringify({
      Origin: "{{ORIGIN_ID}}", Destination: "{{DESTINATION_ID}}", Date: "{{DATE}}", Pax: "{{PASSENGERS}}",
    }));
    vi.stubEnv("SECRET_TOROB", "test-only-placeholder-secret");
    try {
      const calls: { url: string; init?: RequestInit }[] = [];
      const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return String(input).endsWith("robots.txt") ? new Response("User-agent: *\nAllow: /") : new Response("[]");
      });
      const client = new CrawlHttpClient({ fetch: fetcher, sleep: async () => undefined });
      const saveSnapshot = vi.fn(async () => "mock-basisfly-snapshot");
      await runSource(basisflySource, { originCode: "MHD", destinationCode: "THR", departDate: "2026-11-15", passengers: 1, cabin: "economy" }, { client, enabled: true, saveSnapshot });
      expect(calls).toHaveLength(2);
      expect(new Headers(calls[0]?.init?.headers).get("SECRET_TOROB")).toBeNull();
      expect(new Headers(calls[1]?.init?.headers).get("SECRET_TOROB")).toBe("test-only-placeholder-secret");
      expect(JSON.stringify(calls[1]?.init?.body)).not.toContain("test-only-placeholder-secret");
      expect(saveSnapshot).toHaveBeenCalledOnce();
    } finally { vi.unstubAllEnvs(); }
  });

  it("runs the captured Safarmarket POST path against mocked robots and response fixtures", async () => {
    const fixture = await readFile(join(process.cwd(), "tests/fixtures/crawl/safarmarket/THR-MHD-2026-11-22.json"), "utf8");
    const fetcher = vi.fn(async (input: string | URL) => String(input).endsWith("robots.txt")
      ? new Response("User-agent: *\nAllow: /")
      : new Response(fixture));
    const client = new CrawlHttpClient({ fetch: fetcher, sleep: async () => undefined });
    const saveSnapshot = vi.fn(async () => "mock-snapshot-path");
    const snapshot = await runSource(safarmarketSource, { originCode: "THR", destinationCode: "MHD", departDate: "2026-11-22", passengers: 1, cabin: "economy" }, { client, enabled: true, saveSnapshot });
    expect(snapshot.offers).toHaveLength(3);
    expect(saveSnapshot).toHaveBeenCalledWith(expect.objectContaining({ source: "safarmarket", route: "THR-MHD", date: "2026-11-22" }));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps absent Safarmarket facts null", () => {
    const body = JSON.stringify({ code: 200, result: { flights: [{ flightId: "flight-x", leave: {}, providers: [{ price: 1200 }] }] } });
    const offers = safarmarketSource.parseRaw(body, { route: "", date: "", url: "" });
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ id: "flight-x", origin: null, destination: null, departAt: null, arriveAt: null, airline: null, flightNumber: null, currency: "IRR", seats: null, offerUrl: null });
  });
});

describe("crawler HTTP safeguards", () => {
  it("sends JSON POST after robots without browser credentials", async () => {
    const calls: { input: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      return String(input).endsWith("robots.txt") ? new Response("User-agent: *\nAllow: /") : new Response('{"code":200,"result":{"flights":[]}}');
    });
    const client = new CrawlHttpClient({ fetch: fetcher, sleep: async () => undefined });
    const response = await client.postJson("https://example.test/api/search", '{"query":1}');
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.init?.method).toBe("POST");
    expect(calls[1]?.init?.body).toBe('{"query":1}');
    const headers = new Headers(calls[1]?.init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("recaptcha")).toBeNull();
    expect(headers.get("x-auth-token")).toBeNull();
  });

  it("does not retry or follow redirects for POST", async () => {
    let posts = 0;
    const fetcher = vi.fn(async (input: string | URL) => {
      if (String(input).endsWith("robots.txt")) return new Response("User-agent: *\nAllow: /");
      posts += 1;
      return new Response(null, { status: 302, headers: { location: "https://other.test/redirect" } });
    });
    const client = new CrawlHttpClient({ fetch: fetcher, sleep: async () => undefined });
    await expect(client.postJson("https://example.test/api/search", "{}")).rejects.toMatchObject({ code: "HTTP_ERROR" });
    expect(posts).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

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

  it("spaces every request to the same host by the configured minimum delay", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const fetcher = vi.fn(async (input: string | URL) => String(input).endsWith("robots.txt")
      ? new Response("User-agent: *\nAllow: /")
      : new Response("ok"));
    const client = new CrawlHttpClient({
      fetch: fetcher,
      minHostDelayMs: 10_000,
      now: () => now,
      sleep: async (ms) => { sleeps.push(ms); now += ms; },
    });
    await client.get("https://example.test/one");
    await client.get("https://example.test/two");
    expect(sleeps).toEqual([10_000, 10_000]);
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
      const secondRoute = { ...real, route: "THR-SYZ", date: "2026-12-02", fetchedAt: new Date(1).toISOString() };
      await writeSnapshot(secondRoute, root);
      expect((await readSnapshot("fixture-real", root, { route: "THR-MHD", date: "2026-12-01" }))?.route).toBe("THR-MHD");
      expect((await readSnapshot("fixture-real", root, { route: "THR-SYZ", date: "2026-12-02" }))?.route).toBe("THR-SYZ");
      expect(await readSnapshotsForSources(["fixture-real", "synthetic-test"], root)).toHaveLength(2);
      expect(outputPath).toBe(join(root, "latest.json"));
      const latest = JSON.parse(await readFile(outputPath, "utf8")) as { snapshots: { source: string }[] };
      expect(latest.snapshots.map((item) => item.source)).toEqual(["fixture-real", "fixture-real"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
