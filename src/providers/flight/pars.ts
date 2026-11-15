import type { FlightOffer, FlightSegment } from "@/domain/flight";
import type { TripQuery } from "@/domain/trip";
import { materialize } from "@/lib/schedules";
import { minutesBetween } from "@/lib/time";
import { assembleOffer, baggage, NormalizationError, parseAmount } from "../normalize";
import { collectTickets, demoOfferUrl, providerUpdatedAt, type DemoProviderSpec } from "../fixtures";
import { localItinerary, wallClockToInstant } from "../fare";
import type { NormalizationIssue, NormalizationResult, ProviderAdapter } from "../types";

/**
 * "پارس‌فلایت" — an Iranian OTA.
 *
 * Wire-format quirks this adapter exercises:
 *  - prices in **rial** (IRR) as a formatted string
 *  - stop count as a *string* using Persian digits ("۰", "۱", "۲") — untrusted
 *  - local wall-clock times with **no offset** (the classic source of timezone bugs)
 *  - lowercase city ids instead of IATA codes
 */
export interface ParsRawOffer {
  /** Seats this agency says it has left (0..9 in the demo dataset). */
  offerId: string;
  carrierCode: string;
  flightNo: string;
  originCode: string;
  destinationCode: string;
  stopCount: string;
  segments: { flightNo: string; from: string; to: string; departureLocal: string; arrivalLocal: string }[];
  totalPriceRial: string;
  cabinClass: string;
  baggageKg: number | string | null;
  handBagKg: number | null;
  refundable: boolean | null;
  deepLink: string;
  updatedAt: string;
  /** Seats left as a plain number; null when the agency does not say. */
  seatsAvailable?: number | null;
}

const CURRENCY = "IRR" as const;

export const parsAdapter: ProviderAdapter<ParsRawOffer> = {
  id: "pars",
  name: "پارس‌فلایت",
  mode: "demo",
  description: "آژانس آنلاین ایرانی با تمرکز بر پروازهای ترکیه",
  quotedCurrency: CURRENCY,

  async search(query: TripQuery, options?: { now?: Date }): Promise<ParsRawOffer[]> {
    const spec: DemoProviderSpec = {
      id: this.id,
      rules: { markup: 1.0, serviceFeeToman: 0, jitter: 0.05 },
      stalenessMinutes: 12,
      latencyMs: 120,
    };
    const tickets = collectTickets(spec, query, options?.now ?? new Date());
    const faDigit = (n: number) => String(n).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)] ?? d);

    return tickets.map(({ quote, fetchedAt, seatsAvailable }) => {
      const flight = materialize(quote.pattern, quote.dateIso);
      const itinerary = localItinerary(flight);

      return {
        offerId: `${quote.pattern.id}-${quote.dateIso}`,
        carrierCode: flight.pattern.airlineCode,
        flightNo: flight.segments[0]?.flightNumber ?? "",
        originCode: flight.pattern.originCode.toLowerCase(),
        destinationCode: flight.pattern.destinationCode.toLowerCase(),
        stopCount: faDigit(flight.stops),
        segments: itinerary.map((leg) => ({
          flightNo: leg.no,
          from: leg.fromCode.toLowerCase(),
          to: leg.toCode.toLowerCase(),
          departureLocal: leg.departureLocal,
          arrivalLocal: leg.arrivalLocal,
        })),
        totalPriceRial: String(quote.priceToman * 10).replace(/\B(?=(\d{3})+(?!\d))/g, ","),
        cabinClass: flight.pattern.cabin,
        baggageKg: flight.pattern.checkedBaggageKg,
        handBagKg: flight.pattern.cabinBaggageKg,
        refundable: flight.pattern.refundable,
        deepLink: demoOfferUrl(this.id, quote.pattern.id, quote.dateIso),
        updatedAt: providerUpdatedAt(fetchedAt, spec.stalenessMinutes),
        seatsAvailable,
      };
    });
  },

  normalize(raw: ParsRawOffer[]): NormalizationResult {
    const offers: FlightOffer[] = [];
    const issues: NormalizationIssue[] = [];

    for (const record of raw) {
      try {
        const segments: FlightSegment[] = record.segments.map((leg) => {
          const originCode = leg.from.toUpperCase();
          const destinationCode = leg.to.toUpperCase();
          return {
            airlineCode: record.carrierCode,
            flightNumber: leg.flightNo || null,
            originCode,
            destinationCode,
            // Local wall clock → UTC, using each airport's own zone.
            departAt: wallClockToInstant(leg.departureLocal, originCode),
            arriveAt: wallClockToInstant(leg.arrivalLocal, destinationCode),
            aircraft: null,
          };
        });

        const first = segments[0];
        const last = segments[segments.length - 1];
        if (!first || !last) throw new NormalizationError("missing-route", "No segments in pars offer");
        if (minutesBetween(first.departAt, last.arriveAt) <= 0) {
          throw new NormalizationError("invalid-time", "Non-positive total duration");
        }

        const amount = parseAmount(record.totalPriceRial);
        if (amount === null) throw new NormalizationError("invalid-price", "Unparsable rial price");

        const checkedKg =
          record.baggageKg === null || record.baggageKg === undefined ? null : parseAmount(record.baggageKg);

        offers.push(
          assembleOffer({
            providerId: this.id,
            providerName: this.name,
            rawId: record.offerId,
            airlineCode: record.carrierCode,
            flightNumber: first.flightNumber,
            segments,
            price: { amount, currency: CURRENCY },
            baggage: baggage(checkedKg, record.handBagKg ?? null),
            refundable: record.refundable ?? null,
            cabin:
              record.cabinClass === "business"
                ? "business"
                : record.cabinClass === "premium"
                  ? "premium"
                  : "economy",
            offerUrl: record.deepLink,
            providerUpdatedAt: record.updatedAt,
            fetchedAt: record.updatedAt,
            seatsAvailable: record.seatsAvailable ?? null,
            dataSource: this.mode,
            extraWarnings: ["timezone-assumed"],
          }),
        );
      } catch (error) {
        issues.push({
          providerId: this.id,
          rawId: record.offerId ?? null,
          code: error instanceof NormalizationError ? error.code : "missing-route",
          message: error instanceof Error ? error.message : "Unknown normalization error",
        });
      }
    }

    return { offers, issues };
  },
};
