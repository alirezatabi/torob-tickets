import type { FlightOffer, FlightSegment } from "@/domain/flight";
import type { TripQuery } from "@/domain/trip";
import { getCity } from "@/lib/cities";
import { materialize } from "@/lib/schedules";
import { assembleOffer, baggage, formatFlightNumber, NormalizationError, parseAmount } from "../normalize";
import { collectTickets, demoOfferUrl, providerUpdatedAt, type DemoProviderSpec } from "../fixtures";
import { localItinerary, wallClockToInstant } from "../fare";
import type { NormalizationIssue, NormalizationResult, ProviderAdapter } from "../types";

/* ————————————————————————————————————————————————————————————————
   Provider 2 — "علی‌بابا پرواز"
   snake_case • toman as a number • semantic flight_type string
   baggage frequently null (the "unknown" path) • ISO instants with +03:30
   ———————————————————————————————————————————————————————————————— */
export interface AlibabaRawOffer {
  id: number;
  airline_iata: string;
  flight_no: string | null;
  origin: string;
  destination: string;
  departure_at: string;
  arrival_at: string;
  flight_type: "direct" | "with_stop" | "two_stops" | string;
  price_toman: number;
  class_type: string;
  luggage_kg: number | null;
  cabin_luggage_kg: number | null;
  is_refundable: boolean | null;
  link: string;
  last_update: string;
  legs: {
    flight_no: string | null;
    from_iata: string;
    to_iata: string;
    departure_at: string;
    arrival_at: string;
    plane: string | null;
  }[];
}

export const alibabaAdapter: ProviderAdapter<AlibabaRawOffer> = {
  id: "alibaba",
  name: "علی‌بابا پرواز",
  mode: "demo",
  description: "آژانس آنلاین با پوشش گستردهٔ پروازهای داخلی",
  quotedCurrency: "IRT",

  async search(query: TripQuery): Promise<AlibabaRawOffer[]> {
    const spec: DemoProviderSpec = {
      id: this.id,
      coverage: (seed) => seed < 0.75,
      rules: { markup: 1.055, serviceFeeToman: 45_000, jitter: 0.035 },
      stalenessMinutes: 4,
      latencyMs: 90,
    };
    const tickets = collectTickets(spec, query, new Date());
    // This provider prints everything in Iran time, with an explicit offset.
    const withOffset = (iso: string) =>
      new Date(new Date(iso).getTime() + 3.5 * 3_600_000).toISOString().replace("Z", "+03:30");

    return tickets.map(({ quote, fetchedAt }) => {
      const flight = materialize(quote.pattern, quote.dateIso);
      const typeMap = ["direct", "with_stop", "two_stops"] as const;

      return {
        id: Number.parseInt(quote.pattern.id.replace(/\D/g, "").slice(0, 6) || "1", 10) + Number(quote.dateIso.replace(/-/g, "")),
        airline_iata: flight.pattern.airlineCode,
        flight_no: flight.segments[0]?.flightNumber ?? null,
        origin: flight.pattern.originCode,
        destination: flight.pattern.destinationCode,
        departure_at: withOffset(flight.departAtUtc),
        arrival_at: withOffset(flight.arriveAtUtc),
        flight_type: typeMap[Math.min(flight.stops, 2)] ?? "with_stop",
        price_toman: quote.priceToman,
        class_type: flight.pattern.cabin,
        luggage_kg: flight.pattern.checkedBaggageKg,
        cabin_luggage_kg: flight.pattern.cabinBaggageKg,
        is_refundable: flight.pattern.refundable,
        link: demoOfferUrl(this.id, quote.pattern.id, quote.dateIso),
        last_update: providerUpdatedAt(fetchedAt, spec.stalenessMinutes),
        legs: flight.segments.map((segment) => ({
          flight_no: segment.flightNumber,
          from_iata: segment.originCode,
          to_iata: segment.destinationCode,
          departure_at: withOffset(segment.departAt),
          arrival_at: withOffset(segment.arriveAt),
          plane: segment.aircraft,
        })),
      };
    });
  },

  normalize(raw: AlibabaRawOffer[]): NormalizationResult {
    const offers: FlightOffer[] = [];
    const issues: NormalizationIssue[] = [];

    for (const record of raw) {
      try {
        if (!record.legs?.length) throw new NormalizationError("missing-route", "Offer without legs");

        const segments: FlightSegment[] = record.legs.map((leg) => ({
          airlineCode: record.airline_iata,
          flightNumber: formatFlightNumber(record.airline_iata, leg.flight_no),
          originCode: leg.from_iata.toUpperCase(),
          destinationCode: leg.to_iata.toUpperCase(),
          departAt: toUtc(leg.departure_at),
          arriveAt: toUtc(leg.arrival_at),
          aircraft: leg.plane,
        }));

        const price = parseAmount(record.price_toman);
        if (price === null || price <= 0) throw new NormalizationError("invalid-price", "Missing toman price");

        offers.push(
          assembleOffer({
            providerId: this.id,
            providerName: this.name,
            rawId: String(record.id),
            airlineCode: record.airline_iata,
            flightNumber: formatFlightNumber(record.airline_iata, record.flight_no),
            segments,
            price: { amount: price, currency: "IRT" },
            baggage: baggage(record.luggage_kg, record.cabin_luggage_kg),
            refundable: record.is_refundable ?? null,
            cabin:
              record.class_type === "business" ? "business" : record.class_type === "premium" ? "premium" : "economy",
            offerUrl: record.link,
            providerUpdatedAt: record.last_update,
            fetchedAt: new Date().toISOString(),
            dataSource: this.mode,
          }),
        );
      } catch (error) {
        issues.push({
          providerId: this.id,
          rawId: record.id ? String(record.id) : null,
          code: error instanceof NormalizationError ? error.code : "missing-route",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return { offers, issues };
  },
};

/* ————————————————————————————————————————————————————————————————
   Provider 3 — "فلایتیو"
   nested itinerary.legs[] • prices in EUR with decimals (FX path)
   city *names* instead of IATA • advertised duration that must be distrusted
   ———————————————————————————————————————————————————————————————— */
export interface FlightioRawOffer {
  search_id: string;
  carrier: { code: string; name: string };
  itinerary: {
    legs: { no: string; from_city: string; to_city: string; dep_local: string; arr_local: string; equipment?: string }[];
    advertised_duration_min?: number;
  };
  fare: { amount: number; currency: string };
  baggage_policy?: { checked_kg?: number | null; cabin_kg?: number | null } | null;
  refund_policy?: { refundable?: boolean | null } | null;
  booking_url: string;
  refreshed_at: string;
  cabin?: string;
}

const CITY_BY_NAME = new Map<string, string>(
  [
    ["tehran", "THR"],
    ["istanbul", "IST"],
    ["dubai", "DXB"],
    ["mashhad", "MHD"],
    ["frankfurt", "FRA"],
    ["muscat", "MCT"],
    ["shiraz", "SYZ"],
    ["isfahan", "IFN"],
    ["tabriz", "TBZ"],
    ["najaf", "NJF"],
    ["berlin", "BER"],
    ["london", "LHR"],
    ["amsterdam", "AMS"],
    ["antalya", "AYT"],
  ] as const,
);

export const flightioAdapter: ProviderAdapter<FlightioRawOffer> = {
  id: "flightio",
  name: "فلایتیو",
  mode: "demo",
  description: "آژانس بین‌المللی با قیمت‌گذاری به یورو",
  quotedCurrency: "EUR",

  async search(query: TripQuery): Promise<FlightioRawOffer[]> {
    const spec: DemoProviderSpec = {
      id: this.id,
      coverage: (seed) => seed < 0.66,
      rules: { markup: 0.985, serviceFeeToman: 0, jitter: 0.06 },
      stalenessMinutes: 26,
      latencyMs: 160,
    };
    const tickets = collectTickets(spec, query, new Date());

    return tickets.map(({ quote, fetchedAt }) => {
      const flight = materialize(quote.pattern, quote.dateIso);
      const eur = Math.round((quote.priceToman / 100_000) * 100) / 100;

      return {
        search_id: `${quote.pattern.id}:${quote.dateIso}`,
        carrier: { code: flight.pattern.airlineCode, name: flight.pattern.airlineCode },
        itinerary: {
          legs: localItinerary(flight).map((leg) => ({
            no: leg.no,
            from_city: getCity(leg.fromCode)?.en.toLowerCase() ?? leg.fromCode.toLowerCase(),
            to_city: getCity(leg.toCode)?.en.toLowerCase() ?? leg.toCode.toLowerCase(),
            dep_local: leg.departureLocal,
            arr_local: leg.arrivalLocal,
            equipment: leg.aircraft,
          })),
          // Deliberately wrong: normalization must recompute the duration.
          advertised_duration_min: flight.durationMinutes + 35,
        },
        fare: { amount: eur, currency: "EUR" },
        baggage_policy: { checked_kg: flight.pattern.checkedBaggageKg, cabin_kg: flight.pattern.cabinBaggageKg },
        refund_policy: { refundable: flight.pattern.refundable },
        booking_url: demoOfferUrl(this.id, quote.pattern.id, quote.dateIso),
        refreshed_at: providerUpdatedAt(fetchedAt, spec.stalenessMinutes),
        cabin: flight.pattern.cabin,
      };
    });
  },

  normalize(raw: FlightioRawOffer[]): NormalizationResult {
    const offers: FlightOffer[] = [];
    const issues: NormalizationIssue[] = [];

    for (const record of raw) {
      try {
        const legs = record.itinerary?.legs ?? [];
        if (legs.length === 0) throw new NormalizationError("missing-route", "Empty itinerary");

        const segments: FlightSegment[] = legs.map((leg) => {
          const originCode = CITY_BY_NAME.get(leg.from_city.toLowerCase()) ?? leg.from_city.toUpperCase();
          const destinationCode = CITY_BY_NAME.get(leg.to_city.toLowerCase()) ?? leg.to_city.toUpperCase();
          return {
            airlineCode: record.carrier.code,
            flightNumber: leg.no || null,
            originCode,
            destinationCode,
            departAt: wallClockToInstant(leg.dep_local, originCode),
            arriveAt: wallClockToInstant(leg.arr_local, destinationCode),
            aircraft: leg.equipment ?? null,
          };
        });

        if (record.fare.currency !== "EUR") {
          throw new NormalizationError("invalid-price", `Unexpected currency ${record.fare.currency}`);
        }

        offers.push(
          assembleOffer({
            providerId: this.id,
            providerName: this.name,
            rawId: record.search_id,
            airlineCode: record.carrier.code,
            flightNumber: segments[0]?.flightNumber ?? null,
            segments,
            price: { amount: record.fare.amount, currency: "EUR" },
            baggage: baggage(record.baggage_policy?.checked_kg ?? null, record.baggage_policy?.cabin_kg ?? null),
            refundable: record.refund_policy?.refundable ?? null,
            cabin: record.cabin === "business" ? "business" : record.cabin === "premium" ? "premium" : "economy",
            offerUrl: record.booking_url,
            providerUpdatedAt: record.refreshed_at,
            fetchedAt: new Date().toISOString(),
            dataSource: this.mode,
          }),
        );
      } catch (error) {
        issues.push({
          providerId: this.id,
          rawId: record.search_id ?? null,
          code: error instanceof NormalizationError ? error.code : "missing-route",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return { offers, issues };
  },
};

/* ————————————————————————————————————————————————————————————————
   Provider 4 — "ماهان‌سفر" (the messy consolidator)
   duplicates the same physical flight • sometimes omits the flight number
   Persian-digit fares • separate date + time fields • local time per airport
   ———————————————————————————————————————————————————————————————— */
export interface MahanRawOffer {
  ref: string;
  carrier_iata: string;
  flight_number: string | null;
  from_iata: string;
  to_iata: string;
  stop_text: string;
  fare_toman: string;
  bags?: { checked: string | null; cabin: string | null };
  refund?: boolean | null;
  url: string;
  synced_at: string;
  hops: { no: string | null; from: string; to: string; dep_local: string; arr_local: string }[];
}

export const mahanAdapter: ProviderAdapter<MahanRawOffer> = {
  id: "mahan",
  name: "ماهان‌سفر",
  mode: "demo",
  description: "کنسالیدیتور کوچک با دادهٔ ناقص و تکراری (نمونهٔ واقعی وب)",
  quotedCurrency: "IRT",

  async search(query: TripQuery): Promise<MahanRawOffer[]> {
    const spec: DemoProviderSpec = {
      id: this.id,
      coverage: (seed) => seed < 0.85,
      rules: { markup: 1.02, serviceFeeToman: 20_000, jitter: 0.08 },
      stalenessMinutes: 48,
      latencyMs: 210,
    };
    const tickets = collectTickets(spec, query, new Date());
    const faNum = (n: number) => String(n).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)] ?? d);

    const rows: MahanRawOffer[] = [];
    for (const [index, { quote, fetchedAt }] of tickets.entries()) {
      const flight = materialize(quote.pattern, quote.dateIso);
      const itinerary = localItinerary(flight);
      const priceText = faNum(quote.priceToman).replace(/\B(?=(\d{3})+(?!\d))/g, "٬");

      // Every third flight is listed twice with a different ref (a duplication case).
      const duplicate = index % 3 === 0;
      const omitFlightNumber = index % 5 === 1;

      const makeRow = (price: string, flightNumber: string | null, suffix: string): MahanRawOffer => ({
        ref: `${quote.pattern.id}-${quote.dateIso}${suffix}`,
        carrier_iata: flight.pattern.airlineCode,
        flight_number: flightNumber,
        from_iata: flight.pattern.originCode,
        to_iata: flight.pattern.destinationCode,
        stop_text: flight.stops === 0 ? "بدون توقف" : `${faNum(flight.stops)} توقف`,
        fare_toman: price,
        bags: {
          checked: flight.pattern.checkedBaggageKg === null ? null : String(flight.pattern.checkedBaggageKg),
          cabin: flight.pattern.cabinBaggageKg === null ? null : String(flight.pattern.cabinBaggageKg),
        },
        refund: flight.pattern.refundable,
        url: demoOfferUrl(this.id, quote.pattern.id, quote.dateIso),
        synced_at: providerUpdatedAt(fetchedAt, spec.stalenessMinutes),
        hops: itinerary.map((leg) => ({
          no: leg.no,
          from: leg.fromCode,
          to: leg.toCode,
          dep_local: leg.departureLocal,
          arr_local: leg.arrivalLocal,
        })),
      });

      rows.push(makeRow(priceText, omitFlightNumber ? null : flight.segments[0]?.flightNumber ?? null, ""));
      if (duplicate) rows.push(makeRow(priceText, flight.segments[0]?.flightNumber ?? null, "-b"));
    }
    return rows;
  },

  normalize(raw: MahanRawOffer[]): NormalizationResult {
    const offers: FlightOffer[] = [];
    const issues: NormalizationIssue[] = [];

    for (const record of raw) {
      try {
        const hops = record.hops?.length
          ? record.hops
          : [
              {
                no: record.flight_number,
                from: record.from_iata,
                to: record.to_iata,
                dep_local: "",
                arr_local: "",
              },
            ];

        const segments: FlightSegment[] = hops.map((hop) => {
          const originCode = hop.from.toUpperCase();
          const destinationCode = hop.to.toUpperCase();
          return {
            airlineCode: record.carrier_iata,
            flightNumber: formatFlightNumber(record.carrier_iata, hop.no ?? null),
            originCode,
            destinationCode,
            departAt: wallClockToInstant(hop.dep_local, originCode),
            arriveAt: wallClockToInstant(hop.arr_local, destinationCode),
            aircraft: null,
          };
        });

        const amount = parseAmount(record.fare_toman);
        if (amount === null || amount <= 0) throw new NormalizationError("invalid-price", "Unparsable toman fare");

        offers.push(
          assembleOffer({
            providerId: this.id,
            providerName: this.name,
            rawId: record.ref,
            airlineCode: record.carrier_iata,
            flightNumber: formatFlightNumber(record.carrier_iata, record.flight_number),
            segments,
            price: { amount, currency: "IRT" },
            baggage: baggage(
              record.bags?.checked ? parseAmount(record.bags.checked) : null,
              record.bags?.cabin ? parseAmount(record.bags.cabin) : null,
            ),
            refundable: record.refund ?? null,
            cabin: "economy",
            offerUrl: record.url,
            providerUpdatedAt: record.synced_at,
            fetchedAt: new Date().toISOString(),
            dataSource: this.mode,
            extraWarnings: ["timezone-assumed"],
          }),
        );
      } catch (error) {
        issues.push({
          providerId: this.id,
          rawId: record.ref ?? null,
          code: error instanceof NormalizationError ? error.code : "missing-route",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return { offers, issues };
  },
};

function toUtc(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

