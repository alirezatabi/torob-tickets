import { describe, expect, it } from "vitest";

import {
  discoverOffersEndpoint,
  extractApiCandidates,
  extractEmbeddedJson,
  derivedRoutes,
  findOfferArray,
  looksLikeFlightOffer,
  scanText,
  searchBody,
} from "@/modules/providers/shared/api-discovery";
import { mapApiOffer } from "@/modules/providers/sepehr360/json-mapper";
import type { HttpClient } from "@/modules/providers/shared/http";

/**
 * These tests pin the *mechanism*, not a guessed endpoint: given a JavaScript-shell page
 * whose bundles mention a JSON route, discovery must find the route that actually returns
 * flight-shaped objects, and must refuse payloads that are not flight offers.
 */

const PAGE = "https://sepehr360.ir/Flight/B2c/Search?origin=THR&destination=MHD&departureDate=1405-08-28";
const allowHost = (url: URL) => url.host === "sepehr360.ir";

const SHELL = `<!doctype html><html><head><title>سپهر360:نمایش بلیت هواپیما</title></head>
<body><div id="app"></div>
<script src="/assets/app.4f2c.js"></script>
<script src="/assets/vendor.9a1b.js"></script>
</body></html>`;

const BUNDLE = `
  var API_BASE = "https://sepehr360.ir/api/flight/search";
  function other(){ return "/assets/logo.svg"; }
  var notAnApi = "https://cdn.other.example.com/x";
`;

/** Routes are keyed by pathname; the query string is what discovery varies. */
function fakeHttp(routes: Record<string, string | Error>): HttpClient {
  return {
    request: async ({ url }: { url: string }) => {
      const key = new URL(url);
      const entry = routes[`${key.origin}${key.pathname}`];
      if (entry === undefined) throw new Error(`404 ${url}`);
      if (entry instanceof Error) throw entry;
      void 0;
      return { status: 200, body: entry, headers: {}, latencyMs: 5, retries: 0, url, fromCache: false };
    },
    isAllowedHost: (url: URL) => allowHost(url),
  } as unknown as HttpClient;
}

describe("extractApiCandidates", () => {
  it("finds the API literal inside a bundle, and nothing else", () => {
    const candidates = scanText(BUNDLE, PAGE, allowHost, "app.js");
    expect(candidates.map((candidate) => candidate.url)).toEqual(["https://sepehr360.ir/api/flight/search"]);
    expect(candidates[0]?.source).toBe("app.js");
  });

  it("ignores literals on foreign hosts, non-API paths, and http", () => {
    const noise = `
      var a = "https://cdn.other.example.com/api/flight";
      var b = "https://sepehr360.ir/assets/logo.svg";
      var c = "http://sepehr360.ir/api/flight/search";
    `;
    expect(scanText(noise, PAGE, allowHost, "x.js")).toHaveLength(0);
  });

  it("lists the app bundle as the roadmap and drops framework noise", () => {
    const { scripts } = extractApiCandidates(
      // The real page's first two scripts were exactly this pair — 300 KB that never names
      // the fares endpoint. The app chunk is the one worth reading.
      `<!doctype html><html><body>
        <script src="/Flight/B2c/runtime.cc96c6be35fde7e3.js"></script>
        <script src="/Flight/B2c/polyfills.216cfe321010e39c.js"></script>
        <script src="/Flight/B2c/main.77aa11bb22cc33dd.js"></script>
        <script src="/Flight/B2c/styles.css"></script>
      </body></html>`,
      PAGE,
      allowHost,
    );
    expect(scripts).toEqual(["https://sepehr360.ir/Flight/B2c/main.77aa11bb22cc33dd.js"]);
  });
});

describe("looksLikeFlightOffer / findOfferArray", () => {
  const offer = {
    airlineCode: "IR",
    price: 5_902_000,
    departTime: "07:30",
    arriveTime: "08:50",
  };

  it("accepts an object with price, departure and arrival", () => {
    expect(looksLikeFlightOffer(offer)).toBe(true);
  });

  it("rejects objects missing a required dimension", () => {
    expect(looksLikeFlightOffer({ price: 1, departTime: "07:30" })).toBe(false);
    expect(looksLikeFlightOffer({ airlineCode: "IR", price: 1 })).toBe(false);
    expect(looksLikeFlightOffer({})).toBe(false);
  });

  it("finds the offers array inside a wrapper payload", () => {
    const payload = { status: 200, data: { flights: [offer, { ...offer, price: 6_120_000 }] } };
    const found = findOfferArray(payload);
    expect(found?.items).toHaveLength(2);
    expect(found?.path).toBe("data.flights");
  });

  it("does not mistake an unrelated array of objects for offers", () => {
    const payload = { data: { filters: [{ id: 1, title: "ماهان" }, { id: 2, title: "آسمان" }] } };
    expect(findOfferArray(payload)).toBeNull();
  });
});

describe("discoverOffersEndpoint", () => {
  const jsonFeed = JSON.stringify({
    data: {
      result: [
        { airlineCode: "IR", price: 5_902_000, departTime: "07:30", arriveTime: "08:50", stops: 0 },
        { airlineCode: "W5", price: 6_120_000, departTime: "09:15", arriveTime: "10:40", stops: 0 },
      ],
    },
  });

  it("walks the page → bundle → endpoint and returns the offers", async () => {
    const http = fakeHttp({
      "https://sepehr360.ir/assets/app.4f2c.js": BUNDLE,
      "https://sepehr360.ir/assets/vendor.9a1b.js": "/* empty */",
      "https://sepehr360.ir/api/flight/search": jsonFeed,
    });

    const result = await discoverOffersEndpoint({ http, html: SHELL, pageUrl: PAGE, allowHost });

    // The endpoint is called with the search itself — a fares API is meaningless without it.
    expect(result.endpoint).toBe("https://sepehr360.ir/api/flight/search?origin=THR&destination=MHD&departureDate=1405-08-28");
    expect(result.items).toHaveLength(2);
    expect(result.report.jsonEndpoints[0]).toContain("https://sepehr360.ir/api/flight/search?origin=THR");
    expect(result.report.shapes[0]?.topLevelKeys).toContain("data");
    expect(result.report.shapes[0]?.itemKeys).toContain("price");
  });

  it("reports what it saw when the endpoint returns non-flight JSON", async () => {
    const http = fakeHttp({
      "https://sepehr360.ir/assets/app.4f2c.js": BUNDLE,
      "https://sepehr360.ir/assets/vendor.9a1b.js": "/* empty */",
      "https://sepehr360.ir/api/flight/search": JSON.stringify({ data: { filters: [{ id: 1, title: "x" }] } }),
    });

    const result = await discoverOffersEndpoint({ http, html: SHELL, pageUrl: PAGE, allowHost });

    expect(result.items).toHaveLength(0);
    expect(result.endpoint).toBeNull();
    // Evidence survives: we know a JSON endpoint answered, both with and without the query,
    // and what it contained.
    expect(result.report.jsonEndpoints).toHaveLength(2);
    expect(result.report.shapes[0]?.topLevelKeys).toEqual(["data"]);
    expect(result.report.shapes[0]?.itemKeys).toEqual([]);
  });

  it("never probes a host outside the allowlist", async () => {
    const probed: string[] = [];
    const spy = {
      request: async ({ url }: { url: string }) => {
        probed.push(url);
        return { status: 200, body: "{}", headers: {}, latencyMs: 1, retries: 0, url, fromCache: false };
      },
      isAllowedHost: (url: URL) => allowHost(url),
    } as unknown as HttpClient;

    await discoverOffersEndpoint({ http: spy, html: SHELL, pageUrl: PAGE, allowHost });
    expect(probed.every((url) => new URL(url).host === "sepehr360.ir")).toBe(true);
  });

  it("survives a bundle that errors and still probes the inline candidate", async () => {
    const htmlWithInline = SHELL.replace("</body>", `<script>var u = "/api/flight/search";</script></body>`);
    const http = fakeHttp({
      "https://sepehr360.ir/assets/app.4f2c.js": new Error("http-404"),
      "https://sepehr360.ir/assets/vendor.9a1b.js": new Error("http-404"),
      "https://sepehr360.ir/api/flight/search": jsonFeed,
    });

    const result = await discoverOffersEndpoint({ http, html: htmlWithInline, pageUrl: PAGE, allowHost });
    expect(result.items).toHaveLength(2);
  });
});

describe("extractEmbeddedJson", () => {
  it("reads a JSON script block", () => {
    const html = `<html><script type="application/json">{"data":{"flights":[{"price":1,"departTime":"07:30","arriveTime":"08:50"}]}}</script></html>`;
    const blobs = extractEmbeddedJson(html);
    expect(blobs).toHaveLength(1);
    expect(findOfferArray(blobs[0])?.items).toHaveLength(1);
  });

  it("reads a window state assignment", () => {
    const html = `<script>window.__STATE__ = {"flights":[{"price":1,"departTime":"07:30","arriveTime":"08:50"}]};</script>`;
    const blobs = extractEmbeddedJson(html);
    expect(blobs).toHaveLength(1);
    expect(findOfferArray(blobs[0])?.items).toHaveLength(1);
  });

  it("survives a broken blob and returns nothing rather than guessing", () => {
    expect(extractEmbeddedJson(`<script type="application/json">{"a":</script>`)).toEqual([]);
  });

  it("takes precedence over probing: no request is made when the page has the data", async () => {
    const html = `${SHELL}<script type="application/json">{"data":{"result":[{"airlineCode":"IR","price":5902000,"departTime":"07:30","arriveTime":"08:50"}]}}</script>`;
    let requests = 0;
    const http = {
      request: async () => {
        requests += 1;
        throw new Error("must not be called");
      },
      isAllowedHost: () => true,
    } as unknown as HttpClient;

    const result = await discoverOffersEndpoint({ http, html, pageUrl: PAGE, allowHost });
    expect(requests).toBe(0);
    expect(result.endpoint).toBe(PAGE);
    expect(result.items).toHaveLength(1);
  });
});

describe("a client-side source that serves one HTML shell for every path", () => {
  // This is the failure the operator hit, reproduced: every path answers 200 with the same
  // 5151-byte SPA shell, including `/Flight/B2c/gtm.start`, and the fares only exist behind
  // an `Accept: application/json` request to the site's own data route.
  const SHELL_5151 = `<!doctype html><html><head><title>سپهر360:نمایش بلیت هواپیما - خرید بلیت چارتر و ارزان هواپیما</title></head>
  <body><div id="app"></div>
  <script src="/Flight/B2c/runtime.cc96c6be35fde7e3.js"></script>
  <script src="/Flight/B2c/polyfills.216cfe321010e39c.js"></script>
  <script src="/Flight/B2c/main.77aa11bb22cc33dd.js"></script>
  </body></html>`;

  const FEED = JSON.stringify({
    data: {
      flights: [
        { airlineCode: "VR", price: 6_800_000, departTime: "13:00", arriveTime: "14:15" },
        { airlineCode: "W5", price: 11_606_000, departTime: "17:45", arriveTime: "19:10" },
      ],
    },
  });

  const RUNTIME = 'var s = "gtm.start"; var d = "dataLayer"; var g = "GTM-KMZRMWH";';
  const MAIN = 'var api = "/Flight/B2c/api/search"; var other = "https://www.googletagmanager.com/gtm.js";';

  /** Serves the shell for every path; JSON only when the caller asks for JSON. */
  function spaHttp(options: { jsonPath: string; honourAccept?: boolean }) {
    const calls: Array<{ url: string; accept?: string }> = [];
    const http = {
      request: async ({ url, headers }: { url: string; headers?: Record<string, string> }) => {
        calls.push({ url, accept: headers?.accept });
        const path = new URL(url).pathname;
        const wantsJson = (headers?.accept ?? "").includes("application/json");
        if (options.honourAccept !== false && wantsJson && path === options.jsonPath) {
          return { status: 200, body: FEED, headers: {}, latencyMs: 1, retries: 0, url, fromCache: false };
        }
        if (path.endsWith("/runtime.cc96c6be35fde7e3.js")) {
          return { status: 200, body: RUNTIME, headers: {}, latencyMs: 1, retries: 0, url, fromCache: false };
        }
        if (path.endsWith("/main.77aa11bb22cc33dd.js")) {
          return { status: 200, body: MAIN, headers: {}, latencyMs: 1, retries: 0, url, fromCache: false };
        }
        return { status: 200, body: SHELL_5151, headers: {}, latencyMs: 1, retries: 0, url, fromCache: false };
      },
      isAllowedHost: (url: URL) => allowHost(url),
    } as unknown as HttpClient;
    return { http, calls };
  }

  it("finds the feed on the route the page's own bundle names", async () => {
    const { http, calls } = spaHttp({ jsonPath: "/Flight/B2c/api/search" });
    const result = await discoverOffersEndpoint({ http, html: SHELL_5151, pageUrl: PAGE, allowHost });

    expect(result.items).toHaveLength(2);
    expect(result.endpoint).toContain("/Flight/B2c/api/search");
    // Every probe asked for JSON (bundle fetches are the only plain GETs); none was a blind
    // HTML GET that the shell could satisfy with 5151 bytes.
    expect(calls.filter((call) => call.accept !== undefined).every((call) => call.accept!.includes("application/json"))).toBe(true);
    // No bundle was fetched beyond the two allowed, and no tag-manager junk was probed.
    expect(calls.some((call) => /gtm\.start|dataLayer|GTM-KMZRMWH/.test(call.url))).toBe(false);
    expect(calls.some((call) => call.url.includes("googletagmanager"))).toBe(false);
  });

  it("finds it even when no bundle names a route (derived from the page's own layout)", async () => {
    const { http } = spaHttp({ jsonPath: "/Flight/B2c/api/search" });
    // Bundles are unavailable; only the page's structure remains.
    const blind = {
      request: async ({ url, headers }: { url: string; headers?: Record<string, string> }) => {
        const path = new URL(url).pathname;
        if ((headers?.accept ?? "").includes("application/json") && path === "/Flight/B2c/api/search") {
          return { status: 200, body: FEED, headers: {}, latencyMs: 1, retries: 0, url, fromCache: false };
        }
        throw new Error("404");
      },
      isAllowedHost: () => true,
    } as unknown as HttpClient;

    const result = await discoverOffersEndpoint({ http: blind, html: SHELL_5151, pageUrl: PAGE, allowHost });
    expect(result.items).toHaveLength(2);
    expect(result.endpoint).toContain("/Flight/B2c/api/search");
    expect(http).toBeDefined();
  });

  it("reports sameUrlApi when even the search URL only returns the shell", async () => {
    const shellOnly = {
      request: async ({ url }: { url: string }) => ({
        status: 200,
        body: SHELL_5151,
        headers: {},
        latencyMs: 1,
        retries: 0,
        url,
        fromCache: false,
      }),
      isAllowedHost: () => true,
    } as unknown as HttpClient;

    const result = await discoverOffersEndpoint({ http: shellOnly, html: SHELL_5151, pageUrl: PAGE, allowHost });
    expect(result.items).toEqual([]);
    expect(result.report.sameUrlApi).toBe(true);
    expect(result.report.shapes).toEqual([]);
  });
});

describe("derivedRoutes", () => {
  it("stays inside the page's own directory and carries the search", () => {
    const routes = derivedRoutes("https://sepehr360.ir/Flight/B2c/Search?origin=THR&destination=MHD");
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every((route) => route.startsWith("https://sepehr360.ir/Flight/B2c/"))).toBe(true);
    expect(routes.every((route) => route.includes("origin=THR"))).toBe(true);
  });

  it("returns nothing for a page that has no directory to work from", () => {
    expect(derivedRoutes("https://sepehr360.ir/")).toEqual([]);
  });
});

describe("POST fallback", () => {
  const offer = { airlineCode: "IR", price: 5_902_000, departTime: "07:30", arriveTime: "08:50" };

  it("restates the page search as a JSON body", () => {
    const body = searchBody(PAGE);
    expect(body).toMatchObject({ origin: "THR", destination: "MHD", departureDate: "1405-08-28", adults: "1" });
    expect(body.passengers).toBeUndefined();
  });

  it("uses one POST when nothing answered a GET with JSON", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const http = {
      request: async ({ url, method, body }: { url: string; method?: string; body?: string }) => {
        calls.push({ url, method, body });
        if (url.includes("/assets/")) return { body: BUNDLE, status: 200, headers: {}, latencyMs: 1, retries: 0, url, fromCache: false };
        if (method === "POST") return { body: JSON.stringify({ data: { flights: [offer] } }), status: 200, headers: {}, latencyMs: 1, retries: 0, url, fromCache: false };
        throw new Error("405");
      },
      isAllowedHost: () => true,
      } as unknown as HttpClient;

    const result = await discoverOffersEndpoint({ http, html: SHELL, pageUrl: PAGE, allowHost });
    expect(result.items).toHaveLength(1);
    const posts = calls.filter((call) => call.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]!.body!)).toMatchObject({ origin: "THR", destination: "MHD" });
  });

  it("does not POST once an endpoint has already answered with JSON", async () => {
    const calls: string[] = [];
    const http = {
      request: async ({ url, method }: { url: string; method?: string }) => {
        calls.push(`${method ?? "GET"} ${url}`);
        if (url.includes("/assets/")) return { body: BUNDLE, status: 200, headers: {}, latencyMs: 1, retries: 0, url, fromCache: false };
        return { body: JSON.stringify({ data: { result: [offer] } }), status: 200, headers: {}, latencyMs: 1, retries: 0, url, fromCache: false };
      },
      isAllowedHost: () => true,
      } as unknown as HttpClient;

    await discoverOffersEndpoint({ http, html: SHELL, pageUrl: PAGE, allowHost });
    expect(calls.some((call) => call.startsWith("POST"))).toBe(false);
  });
});

describe("mapApiOffer", () => {
  it("maps a typical feed object without inventing missing fields", () => {
    const mapped = mapApiOffer(
      {
        airline: { code: "IR", name: "ایران ایر" },
        price: 5_902_000,
        departTime: "07:30",
        arriveTime: "08:50",
        duration: 80,
        stops: 0,
        flightNumber: "IR 452",
        origin: "THR",
        destination: "MHD",
      },
      { unit: "toman" },
    );

    expect(mapped.priceAmount).toBe(5_902_000);
    expect(mapped.priceText).toContain("تومان");
    expect(mapped.departAt).toBe("07:30");
    expect(mapped.arriveAt).toBe("08:50");
    expect(mapped.durationMinutes).toBe(80);
    expect(mapped.stops).toBe(0);
    expect(mapped.airlineCode).toBe("IR");
    expect(mapped.flightNumber).toBe("IR452");
    expect(mapped.originAirport).toBe("THR");
    expect(mapped.destinationAirport).toBe("MHD");
  });

  it("keeps unknown fields unknown instead of filling them", () => {
    const mapped = mapApiOffer({ price: 5_902_000, departTime: "07:30", arriveTime: "08:50" }, { unit: "toman" });
    expect(mapped.airlineCode).toBeNull();
    expect(mapped.flightNumber).toBeNull();
    expect(mapped.durationMinutes).toBeNull();
    expect(mapped.stops).toBeNull();
    expect(mapped.seatsAvailable).toBeNull();
    expect(mapped.originAirport).toBeNull();
  });

  it("rejects implausible values rather than passing them through", () => {
    const mapped = mapApiOffer(
      { price: 12, departTime: "77:99", stops: 42, duration: 9000, airlineCode: "TOOLONG" },
      { unit: "toman" },
    );
    // A 12-toman price is not money; a 77:99 clock is not a time.
    expect(mapped.priceAmount).toBeNull();
    expect(mapped.departAt).toBeNull();
    expect(mapped.stops).toBeNull();
    expect(mapped.durationMinutes).toBeNull();
    expect(mapped.airlineCode).toBeNull();
  });

  it("reads Persian-digit prices", () => {
    const mapped = mapApiOffer({ price: "۵٬۹۰۲٬۰۰۰ تومان", departTime: "۰۷:۳۰", arriveTime: "۰۸:۵۰" }, { unit: "toman" });
    expect(mapped.priceAmount).toBe(5_902_000);
    expect(mapped.departAt).toBe("07:30");
  });
});
