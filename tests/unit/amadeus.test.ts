import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { ProviderSearchRequest } from "@/modules/providers/contracts/provider";
import { AmadeusAdapter, amadeusConfigFromEnv } from "@/modules/providers/amadeus/adapter";
import {
  extractCheckedBaggageKg,
  parseAmountString,
  parseFlightOffersResponse,
  parseIsoDuration,
  parsePricingResponse,
} from "@/modules/providers/amadeus/parse";
import { amadeusBaseUrl, amadeusCredentialsFromEnv, fetchAmadeusToken } from "@/modules/providers/amadeus/auth";
import { createMemoryLogger } from "@/modules/providers/shared/logger";

const fixture = (name: string) =>
  readFileSync(path.join(process.cwd(), "src/modules/providers/amadeus/__fixtures__", name), "utf8");

const REQUEST: ProviderSearchRequest = {
  query: {} as ProviderSearchRequest["query"],
  originCity: "THR",
  destinationCity: "IST",
  originAirports: ["IKA", "THR", "PYK"],
  destinationAirports: ["IST"],
  departDate: "2026-11-20",
  passengers: 1,
  cabin: "economy",
  international: true,
};

const META = {
  providerId: "amadeus",
  fetchedAt: "2026-11-12T10:00:00.000Z",
  latencyMs: 420,
  httpStatus: 200,
  retries: 0,
  fromCache: false,
  endpoint: "GET /v2/shopping/flight-offers (test)",
  sourceUpdatedAt: null,
};

describe("amadeus response parsing", () => {
  it("parses offers, keeps the original payload and records the environment", () => {
    const parsed = parseFlightOffersResponse(JSON.parse(fixture("flight-offers.json")), "test");

    expect(parsed.declaredCount).toBe(2);
    expect(parsed.offers).toHaveLength(2);
    expect(parsed.offers[0]?.env).toBe("test");
    expect(parsed.offers[0]?.raw.id).toBe("1");
    expect(parsed.offers[0]?.numberOfBookableSeats).toBe(9);
    expect(parsed.warnings).toEqual([]);
  });

  it("surfaces an Amadeus errors[] payload instead of pretending there is data", () => {
    const parsed = parseFlightOffersResponse(JSON.parse(fixture("no-results.json")), "test");
    expect(parsed.offers).toEqual([]);
    expect(parsed.warnings).toContain("amadeus-error-32171");
  });

  it("parses decimal price strings exactly", () => {
    expect(parseAmountString("312.45")).toBe(31_245);
    expect(parseAmountString("185")).toBe(18_500);
    expect(parseAmountString("185.1")).toBe(18_510);
    expect(parseAmountString("1,234.56")).toBeNull();
    expect(parseAmountString("12.345")).toBeNull();
    expect(parseAmountString("0.00")).toBeNull();
    expect(parseAmountString(null)).toBeNull();
  });

  it("parses ISO durations", () => {
    expect(parseIsoDuration("PT3H5M")).toBe(185);
    expect(parseIsoDuration("PT45M")).toBe(45);
    expect(parseIsoDuration("P1DT2H")).toBe(1560);
    expect(parseIsoDuration("bad")).toBeNull();
  });

  it("does not invent a baggage weight for a piece allowance", () => {
    const payload = JSON.parse(fixture("flight-offers.json"));
    const parsed = parseFlightOffersResponse(payload, "test");
    expect(extractCheckedBaggageKg(parsed.offers[0]!)).toEqual({ kg: 25, included: true });
    expect(extractCheckedBaggageKg(parsed.offers[1]!)).toEqual({ kg: null, included: true });
  });

  it("reads a re-pricing result, including a changed price", () => {
    expect(parsePricingResponse(JSON.parse(fixture("pricing-changed.json")))).toEqual({
      ok: true,
      total: { amount: 34_120, currency: "EUR" },
      reason: null,
    });
  });

  it("reports an unavailable fare as a reason, not as success", () => {
    const result = parsePricingResponse(JSON.parse(fixture("pricing-unavailable.json")));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("no longer available");
  });
});

describe("amadeus configuration", () => {
  it("keeps test and production credentials strictly separate", () => {
    expect(amadeusCredentialsFromEnv({ AMADEUS_ENV: "test", AMADEUS_CLIENT_ID: "a", AMADEUS_CLIENT_SECRET: "b" })).toEqual({
      clientId: "a",
      clientSecret: "b",
    });
    // Production must not silently use the test key.
    expect(
      amadeusCredentialsFromEnv({ AMADEUS_ENV: "production", AMADEUS_CLIENT_ID: "a", AMADEUS_CLIENT_SECRET: "b" }),
    ).toBeNull();
    expect(
      amadeusCredentialsFromEnv({
        AMADEUS_ENV: "production",
        AMADEUS_CLIENT_ID_PRODUCTION: "p",
        AMADEUS_CLIENT_SECRET_PRODUCTION: "q",
      }),
    ).toEqual({ clientId: "p", clientSecret: "q" });
  });

  it("uses the documented hosts", () => {
    expect(amadeusBaseUrl("test")).toBe("https://test.api.amadeus.com");
    expect(amadeusBaseUrl("production")).toBe("https://api.amadeus.com");
  });

  it("is not configured without credentials", () => {
    const config = amadeusConfigFromEnv({});
    expect(config.credentials).toBeNull();
    expect(new AmadeusAdapter(config).isConfigured()).toBe(false);
  });

  it("refuses to search when not configured, with a clear code", async () => {
    const adapter = new AmadeusAdapter({ enabled: false, env: "test", credentials: null });
    await expect(
      adapter.search(REQUEST, {
        signal: new AbortController().signal,
        logger: createMemoryLogger(),
        now: () => new Date(),
        budgetMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: "not-configured" });
  });
});

describe("amadeus token exchange", () => {
  it("posts client credentials and returns the token", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "tok", expires_in: 1799 }), { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await fetchAmadeusToken({ clientId: "id", clientSecret: "secret" }, "test", fetchImpl);
    expect(result).toEqual({ accessToken: "tok", expiresInSeconds: 1799 });

    const call = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(call?.[0]).toBe("https://test.api.amadeus.com/v1/security/oauth2/token");
    expect(String(call?.[1]?.body)).toContain("grant_type=client_credentials");
  });

  it("reports a 401 without retrying", async () => {
    const fetchImpl = vi.fn(async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
    await expect(
      fetchAmadeusToken({ clientId: "id", clientSecret: "bad" }, "test", fetchImpl),
    ).rejects.toMatchObject({ code: "prohibited", retryable: false });
  });
});

describe("amadeus normalization", () => {
  const parsed = parseFlightOffersResponse(JSON.parse(fixture("flight-offers.json")), "test");
  const adapter = new AmadeusAdapter({ enabled: true, env: "test", credentials: { clientId: "i", clientSecret: "s" } });

  it("builds a direct flight with real instants, fare class and baggage", () => {
    const batch = adapter.normalize([parsed.offers[0]!], REQUEST, META);
    expect(batch.issues).toEqual([]);
    const offer = batch.offers[0]!;

    expect(offer.originCode).toBe("THR"); // IKA maps to the Tehran city catalogue entry
    expect(offer.originAirport).toBe("IKA");
    expect(offer.destinationAirport).toBe("IST");
    expect(offer.flightNumber).toBe("TK-879");
    expect(offer.stops).toBe(0);
    expect(offer.durationMinutes).toBe(185);
    expect(offer.fare?.fareClass).toBe("YOWN");
    expect(offer.baggage.checked).toBe("included");
    expect(offer.baggage.checkedKg).toBe(25);
    expect(offer.seatsAvailable).toBe(9);
    expect(offer.provenance?.sourceKind).toBe("api");
  });

  it("keeps a foreign price in its own currency and marks it incomparable", () => {
    const offer = adapter.normalize([parsed.offers[0]!], REQUEST, META).offers[0]!;
    expect(offer.price.original).toEqual({ amount: 31_245, currency: "EUR" });
    expect(offer.price.toman).toBe(0);
    expect(offer.price.comparable).toBe(false);
    expect(offer.warnings).toContain("price-foreign");
  });

  it("labels test-environment offers so they cannot pass as live prices", () => {
    const offer = adapter.normalize([parsed.offers[0]!], REQUEST, META).offers[0]!;
    expect(offer.warnings).toContain("availability-unverified");
    expect(offer.provenance?.endpoint).toContain("test");
  });

  it("builds the connecting itinerary with a real stop count", () => {
    const offer = adapter.normalize([parsed.offers[1]!], REQUEST, META).offers[0]!;
    expect(offer.stops).toBe(1);
    expect(offer.segments).toHaveLength(2);
    expect(offer.durationMinutes).toBe(500);
    expect(offer.segments.map((segment) => segment.originCode)).toEqual(["IKA", "DOH"]);
  });

  it("gives different ids to different fare bases and keeps them apart", () => {
    const first = adapter.normalize([parsed.offers[0]!], REQUEST, META).offers[0]!;
    const second = adapter.normalize([parsed.offers[1]!], REQUEST, META).offers[0]!;
    expect(first.id).not.toBe(second.id);
  });
});
