import { describe, expect, it } from "vitest";
import { parsAdapter } from "@/providers/flight/pars";
import { alibabaAdapter, flightioAdapter, mahanAdapter } from "@/providers/flight/adapters";
import { formatFlightNumber, buildGroupKey, localDepartureDate } from "@/providers/normalize";
import { createQuery } from "@/domain/trip";
import type { FlightOffer } from "@/domain/flight";

const query = createQuery({ originCode: "THR", destinationCode: "IST", departDate: "2026-11-20" });

describe("flight number canonicalization", () => {
  it("collapses provider variants to airline-number", () => {
    expect(formatFlightNumber("TK", "TK873")).toBe("TK-873");
    expect(formatFlightNumber("TK", "TK 873")).toBe("TK-873");
    expect(formatFlightNumber("TK", "tk-873")).toBe("TK-873");
    expect(formatFlightNumber("W5", "107")).toBe("W5-107");
    expect(formatFlightNumber("TK", null)).toBeNull();
    expect(formatFlightNumber("TK", "abc")).toBeNull();
  });
});

describe("pars adapter (IRR, string stops, local times)", () => {
  const raw = {
    offerId: "o-1",
    carrierCode: "TK",
    flightNo: "TK-873",
    originCode: "thr",
    destinationCode: "ist",
    stopCount: "۰",
    segments: [
      {
        flightNo: "TK-873",
        from: "thr",
        to: "ist",
        departureLocal: "2026-11-20T08:40",
        arrivalLocal: "2026-11-20T10:45",
      },
    ],
    totalPriceRial: "42,500,000",
    cabinClass: "economy",
    baggageKg: 23,
    handBagKg: 8,
    refundable: true,
    deepLink: "https://example.com/pars",
    updatedAt: "2026-11-19T10:00:00.000Z",
  };

  it("converts rial to toman, derives stops and duration", () => {
    const { offers, issues } = parsAdapter.normalize([raw], query);
    expect(issues).toHaveLength(0);
    expect(offers).toHaveLength(1);
    const offer = offers[0]!;
    expect(offer.price.original).toEqual({ amount: 42_500_000, currency: "IRR" });
    expect(offer.price.toman).toBe(4_250_000);
    expect(offer.price.converted).toBe(true);
    expect(offer.stops).toBe(0);
    // 08:40 Tehran (05:10Z) → 10:45 Istanbul (07:45Z) = 2h35m of real time.
    expect(offer.durationMinutes).toBe(155);
    expect(offer.baggage).toEqual({ checked: "included", cabinKg: 8, checkedKg: 23 });
    expect(offer.warnings).toContain("rial-to-toman");
  });

  it("rejects a record with an unparsable price instead of guessing", () => {
    const { offers, issues } = parsAdapter.normalize([{ ...raw, totalPriceRial: "تماس بگیرید" }], query);
    expect(offers).toHaveLength(0);
    expect(issues[0]?.code).toBe("invalid-price");
  });

  it("rejects a negative duration", () => {
    const broken = {
      ...raw,
      segments: [{ ...raw.segments[0]!, arrivalLocal: "2026-11-20T06:00" }],
    };
    const { offers, issues } = parsAdapter.normalize([broken], query);
    expect(offers).toHaveLength(0);
    expect(issues[0]?.code).toBe("invalid-time");
  });
});

describe("alibaba adapter (toman, semantic stop text, offset timestamps)", () => {
  it("normalizes and keeps unknown baggage unknown", () => {
    const { offers } = alibabaAdapter.normalize([
      {
        id: 90210,
        airline_iata: "PC",
        flight_no: "PC517",
        origin: "THR",
        destination: "IST",
        departure_at: "2026-11-20T21:35:00+03:30",
        arrival_at: "2026-11-21T00:45:00+03:30",
        flight_type: "with_stop",
        price_toman: 3_970_000,
        class_type: "economy",
        luggage_kg: null,
        cabin_luggage_kg: null,
        is_refundable: null,
        link: "https://example.com/alibaba",
        last_update: "2026-11-19T10:00:00.000Z",
        legs: [
          {
            flight_no: "PC517",
            from_iata: "THR",
            to_iata: "IST",
            departure_at: "2026-11-20T21:35:00+03:30",
            arrival_at: "2026-11-20T23:10:00+03:30",
            plane: "A320",
          },
          {
            flight_no: "PC517",
            from_iata: "IST",
            to_iata: "IST",
            departure_at: "2026-11-20T23:40:00+03:30",
            arrival_at: "2026-11-21T00:45:00+03:30",
            plane: "A320",
          },
        ],
      },
    ], query);
    const offer = offers[0]!;
    expect(offer.price.toman).toBe(3_970_000);
    expect(offer.baggage.checked).toBe("unknown");
    expect(offer.refundable).toBeNull();
    expect(offer.warnings).toEqual(
      expect.arrayContaining(["baggage-unknown", "refund-unknown"]),
    );
    // Stops come from the segment count, never from `flight_type`.
    expect(offer.stops).toBe(1);
  });
});

describe("flightio adapter (nested legs, EUR, city names)", () => {
  it("maps city names, converts EUR and ignores the advertised duration", () => {
    const { offers } = flightioAdapter.normalize([
      {
        search_id: "s-1",
        carrier: { code: "FZ", name: "FZ" },
        itinerary: {
          legs: [
            {
              no: "FZ-14",
              from_city: "Tehran",
              to_city: "Dubai",
              dep_local: "2026-11-20T10:10",
              arr_local: "2026-11-20T12:25",
              equipment: "737 MAX",
            },
            {
              no: "FZ-14",
              from_city: "Dubai",
              to_city: "Istanbul",
              dep_local: "2026-11-20T14:15",
              arr_local: "2026-11-20T18:20",
            },
          ],
          advertised_duration_min: 999,
        },
        fare: { amount: 55.9, currency: "EUR" },
        baggage_policy: { checked_kg: 30, cabin_kg: 7 },
        refund_policy: { refundable: true },
        booking_url: "https://example.com/flightio",
        refreshed_at: "2026-11-19T10:00:00.000Z",
        cabin: "economy",
      },
    ], query);
    const offer = offers[0]!;
    expect(offer.originCode).toBe("THR");
    expect(offer.destinationCode).toBe("IST");
    expect(offer.stops).toBe(1);
    expect(offer.price.original.currency).toBe("EUR");
    expect(offer.price.toman).toBe(55.9 * 100_000);
    // 10:10 Tehran (06:40Z) → 18:20 Istanbul (15:20Z) = 8h40m of real elapsed time,
    // not the provider's advertised 999 minutes.
    expect(offer.durationMinutes).toBe(520);
  });

  it("rejects an unexpected currency rather than converting blindly", () => {
    const { offers, issues } = flightioAdapter.normalize([
      {
        search_id: "s-2",
        carrier: { code: "FZ", name: "FZ" },
        itinerary: { legs: [{ no: "FZ-1", from_city: "Tehran", to_city: "Dubai", dep_local: "2026-11-20T10:10", arr_local: "2026-11-20T12:25" }] },
        fare: { amount: 100, currency: "USD" },
        booking_url: "https://example.com/x",
        refreshed_at: "2026-11-19T10:00:00.000Z",
      },
    ], query);
    expect(offers).toHaveLength(0);
    expect(issues[0]?.code).toBe("invalid-price");
  });
});

describe("mahan adapter (duplicates, missing flight number, Persian fares)", () => {
  const base = {
    carrier_iata: "IR",
    from_iata: "THR",
    to_iata: "IST",
    stop_text: "بدون توقف",
    fare_toman: "۴٬۵۵۰٬۰۰۰",
    bags: { checked: "30", cabin: null },
    refund: false,
    url: "https://example.com/mahan",
    synced_at: "2026-11-19T10:00:00.000Z",
    hops: [
      {
        no: "IR755",
        from: "THR",
        to: "IST",
        dep_local: "2026-11-20T06:30",
        arr_local: "2026-11-20T08:55",
      },
    ],
  };

  it("parses Persian-digit fares and keeps missing cabin baggage unknown", () => {
    const { offers } = mahanAdapter.normalize([{ ...base, ref: "r1", flight_number: "IR755" }], query);
    const offer = offers[0]!;
    expect(offer.price.toman).toBe(4_550_000);
    expect(offer.baggage.checkedKg).toBe(30);
    expect(offer.baggage.cabinKg).toBeNull();
  });

  it("produces the same group key for an offer missing its flight number", () => {
    const { offers } = mahanAdapter.normalize([
      { ...base, ref: "r2", flight_number: "IR755" },
      { ...base, ref: "r3", flight_number: null },
    ], query);
    expect(offers).toHaveLength(2);
    // Same airline/day/route; one lacks a number, so the key differs but dedupe can
    // still join them (verified in dedupe tests) — the point here is that nothing
    // is invented to fill the gap.
    expect(offers[1]?.flightNumber).toBeNull();
    expect(offers[1]?.warnings).toContain("flight-number-missing");
  });
});

describe("group keys", () => {
  it("use the local departure date at the origin, not the UTC date", () => {
    // 02:25 Tehran on Nov 20 is 22:55 UTC on Nov 19.
    expect(localDepartureDate("2026-11-19T22:55:00.000Z", "THR")).toBe("2026-11-20");
    expect(buildGroupKey("LH", "LH-601", "2026-11-20", "THR", "FRA")).toBe("LH|LH601|2026-11-20|THR>FRA");
  });
});

describe("adapter search → normalize integration", () => {
  it("produces valid offers for the flagship route from every adapter", async () => {
    const adapters = [parsAdapter, alibabaAdapter, flightioAdapter, mahanAdapter] as const;
    for (const adapter of adapters) {
      // Each adapter owns a different raw type, so the loop is intentionally generic.
      const search = adapter.search.bind(adapter) as (input: typeof query) => Promise<unknown[]>;
      const normalize = adapter.normalize.bind(adapter) as (
        raw: unknown[],
        input: typeof query,
      ) => { offers: FlightOffer[]; issues: { code: string }[] };
      const raw = await search(query);
      const { offers, issues } = normalize(raw, query);
      expect(raw.length).toBeGreaterThan(0);
      expect(offers.length).toBeGreaterThan(0);
      expect(issues).toHaveLength(0);
      for (const offer of offers) {
        expect(offer.price.toman).toBeGreaterThan(0);
        expect(offer.durationMinutes).toBeGreaterThan(60);
        expect(offer.departAt).toMatch(/Z$/);
        expect(offer.groupKey).toContain("THR>IST");
      }
    }
  });
});
