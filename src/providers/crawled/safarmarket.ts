import type { FlightOffer, FlightSegment } from "@/domain/flight";
import type { TripQuery, CabinClass } from "@/domain/trip";
import { assembleOffer, baggage, NormalizationError } from "@/providers/normalize";
import type { NormalizationIssue, NormalizationResult, ProviderAdapter } from "@/providers/types";
import { readSnapshot } from "@/crawler/store";
import type { RawOffer } from "@/crawler/types";
import { localToUtcIso } from "@/lib/time";

interface SnapshotQuote {
  raw: RawOffer;
  fetchedAt: string;
}

const IATA = /^[A-Z]{3}$/;

/** Local snapshot adapter: reads disk only; it never starts or refreshes a crawl. */
export const safarmarketSnapshotAdapter: ProviderAdapter<SnapshotQuote> = {
  id: "safarmarket",
  name: "Safarmarket · snapshot",
  mode: "crawled",
  description: "نرخ‌های ذخیره‌شده از snapshot محلی Safarmarket",
  quotedCurrency: "IRT",

  async search(query: TripQuery): Promise<SnapshotQuote[]> {
    const snapshot = await readSnapshot("safarmarket");
    const route = `${query.originCode}-${query.destinationCode}`;
    if (!snapshot || snapshot.route.toUpperCase() !== route || snapshot.date !== query.departDate) return [];
    return snapshot.offers.map((raw) => ({ raw, fetchedAt: snapshot.fetchedAt }));
  },

  normalize(records: SnapshotQuote[], query: TripQuery): NormalizationResult {
    const offers: FlightOffer[] = [];
    const issues: NormalizationIssue[] = [];

    for (const { raw, fetchedAt } of records) {
      try {
        const segments = readSegments(raw);
        const first = segments[0];
        if (!first) throw new NormalizationError("missing-route", "Snapshot quote has no complete captured leg");
        const sourceStops = readNumber(raw.stopsCount);
        if (sourceStops !== null && sourceStops !== segments.length - 1) {
          throw new NormalizationError("missing-route", "Captured leg count does not match the source stop count");
        }
        const amount = readNumber(raw.amount);
        if (amount === null || amount <= 0) throw new NormalizationError("invalid-price", "Snapshot quote has no valid price");
        const cabin = parseCabin(raw.flightClass);
        if (!cabin) throw new NormalizationError("missing-route", "Snapshot quote has no recognized captured cabin class");
        if (cabin !== query.cabin) continue;
        const airlineCode = readText(raw.airlineCode) ?? first.airlineCode;
        if (!airlineCode) throw new NormalizationError("missing-route", "Snapshot quote has no captured airline code");
        const rawId = readText(raw.id);
        const providerId = readText(raw.providerId) ?? readText(raw.providerRecordId) ?? rawId;
        if (!providerId) throw new NormalizationError("missing-route", "Snapshot quote has no seller identity");
        const providerName = readText(raw.providerName) ?? providerId;
        const checkedKg = adultCheckedBagKg(raw.baggage);
        const assembled = assembleOffer({
          providerId,
          providerName,
          rawId,
          airlineCode,
          flightNumber: readText(raw.flightNumber) ?? first.flightNumber,
          segments,
          price: { amount, currency: "IRT" },
          baggage: baggage(checkedKg, null),
          refundable: null,
          cabin,
          offerUrl: "",
          providerUpdatedAt: fetchedAt,
          fetchedAt,
          dataSource: "crawled",
          seatsAvailable: readNumber(raw.seats),
          extraWarnings: ["currency-assumed", "timezone-assumed"],
        });
        const sourceAirlineName = readText(raw.airlineNameFa) ?? readText(raw.airline);
        const sellType = readText(raw.sellType)?.toUpperCase();
        offers.push({
          ...assembled,
          airlineName: sourceAirlineName ?? assembled.airlineName,
          freshness: "unverified",
          priceObservedAt: fetchedAt,
          lastVerifiedAt: null,
          fare: {
            cabin,
            fareClass: null,
            ticketType: sellType === "CHARTER" ? "charter" : sellType === "SYSTEM" ? "system" : "unknown",
            fareName: null,
          },
          provenance: {
            sourceKind: "api",
            endpoint: "https://safarmarket.com/api/flight/v3/search",
            rawRecordId: readText(raw.providerRecordId),
            sellerLabel: providerName,
            unitConverted: false,
            mergedRows: 1,
            sellerCount: null,
          },
        });
      } catch (error) {
        issues.push({
          providerId: "safarmarket",
          rawId: readText(raw.id),
          code: error instanceof NormalizationError ? error.code : "missing-route",
          message: error instanceof Error ? error.message : "Could not normalize captured Safarmarket quote",
        });
      }
    }

    return { offers, issues };
  },
};

function readSegments(raw: RawOffer): FlightSegment[] {
  const sourceSegments = Array.isArray(raw.sourceSegments) ? raw.sourceSegments : [];
  const parsed = sourceSegments.map((value) => {
    const leg = asRecord(value);
    if (!leg) return null;
    const originCode = readText(leg.originCode);
    const destinationCode = readText(leg.destinationCode);
    const airlineCode = readText(leg.airlineCode) ?? readText(raw.airlineCode);
    const flightNumber = readText(leg.flightNumber) ?? readText(raw.flightNumber);
    const departAt = readText(leg.departAt) ?? iranLocalInstant(readText(leg.departureLocal));
    const arriveAt = readText(leg.arriveAt) ?? iranLocalInstant(readText(leg.arrivalLocal));
    if (!originCode || !IATA.test(originCode) || !destinationCode || !IATA.test(destinationCode) || !airlineCode || !departAt || !arriveAt) return null;
    return { airlineCode, flightNumber, originCode, destinationCode, departAt, arriveAt, aircraft: readText(leg.aircraft) };
  });
  if (sourceSegments.length > 0) return parsed.filter((segment): segment is FlightSegment => segment !== null);

  // Backward-compatible path for earlier direct-flight snapshots that predate sourceSegments.
  if (readNumber(raw.stopsCount) !== 0) return [];
  const originCode = readText(raw.origin);
  const destinationCode = readText(raw.destination);
  const airlineCode = readText(raw.airlineCode);
  const departAt = readText(raw.departAt) ?? iranLocalInstant(readText(raw.departureLocal));
  const arriveAt = readText(raw.arriveAt) ?? iranLocalInstant(readText(raw.arrivalLocal));
  if (!originCode || !IATA.test(originCode) || !destinationCode || !IATA.test(destinationCode) || !airlineCode || !departAt || !arriveAt) return [];
  return [{ airlineCode, flightNumber: readText(raw.flightNumber), originCode, destinationCode, departAt, arriveAt, aircraft: readText(raw.aircraft) }];
}

function iranLocalInstant(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText); const month = Number(monthText); const day = Number(dayText);
  const hour = Number(hourText); const minute = Number(minuteText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59) return null;
  return localToUtcIso(`${yearText}-${monthText}-${dayText}`, hour * 60 + minute, "Asia/Tehran");
}
function parseCabin(value: unknown): CabinClass | null {
  const cabin = readText(value)?.toUpperCase();
  if (cabin === "ECONOMY") return "economy";
  if (cabin === "PREMIUM" || cabin === "PREMIUM_ECONOMY") return "premium";
  if (cabin === "BUSINESS") return "business";
  return null;
}
function adultCheckedBagKg(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  const adult = value.map(asRecord).find((item) => item && readText(item.passengerType)?.toUpperCase() === "ADULT");
  if (!adult || readNumber(adult.pieces) === 0) return null;
  const weight = adult.weightKg;
  if (typeof weight === "number" && Number.isFinite(weight) && weight > 0) return weight;
  if (typeof weight === "string" && /^\d+(?:\.\d+)?$/.test(weight)) return Number(weight);
  return null;
}
function readText(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return null;
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
