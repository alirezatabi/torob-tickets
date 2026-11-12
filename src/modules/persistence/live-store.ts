/**
 * Persistence for live searches — idempotent by construction.
 *
 * The hard parts this module exists to solve (correction #5):
 *   • the same request may arrive twice concurrently (double-click, retry, cache
 *     miss); a unique `requestHash`+`startedAt` bucket plus upserts make that safe;
 *   • providers can fail *after* some offers were normalized; the search row records
 *     `partial` and stores what actually arrived, never a fabricated full set;
 *   • the same product seen twice must not create a second offer row → upsert on
 *     `(providerId, offerKey)`;
 *   • price history is append-only and only written when the price actually differs
 *     from the last observation (no invented points on every page view).
 *
 * All writes happen in one transaction, so a failure cannot leave a search with
 * offers but no history (or vice versa).
 */


import type { FlightOffer } from "@/domain/flight";
import type { ProviderRunReport } from "@/modules/providers/contracts/provider";
import { getDb } from "@/modules/db/prisma";
import { withTransaction } from "@/modules/db/transaction";
import { DatabaseError, mapPrismaError } from "@/modules/db/errors";
import { baggageFacts, localDate } from "@/modules/providers/shared/normalize-offer";
import { offerKey, type FareFacts } from "@/modules/live/offer-identity";
import type {
  FlightOfferCreateInput,
  JsonValue,
  PriceObservationRowInput,
  TypedDb,
} from "@/modules/db/client-types";

export interface PersistSearchInput {
  query: {
    originCity: string;
    destinationCity: string;
    departDate: string; // YYYY-MM-DD
    passengers: number;
    cabin: string;
  };
  mode: "LIVE" | "DEMO";
  startedAt: Date;
  reports: ProviderRunReport[];
  offers: FlightOffer[];
}

export interface PersistSearchResult {
  searchId: string;
  offersWritten: number;
  observationsWritten: number;
  status: "ok" | "partial" | "failed";
  /** True when the identical request hash was already recorded moments ago. */
  deduped: boolean;
}

const DEDUPE_WINDOW_MS = 20_000;

/**
 * Every offer has a foreign key to `live_providers`, so the provider row must exist
 * before the first offer is written — otherwise the very first live search fails on a
 * foreign-key violation. The row is derived from the run reports (code is the source of
 * truth for capabilities/compliance), and upserted inside the same transaction.
 */
function providerRowFromReport(report: ProviderRunReport): {
  id: string;
  name: string;
  mode: "LIVE" | "DEMO";
  sourceKind: string;
  quotedCurrency: string;
  capabilities: JsonValue;
  complianceNote: string;
  enabled: boolean;
} {
  return {
    id: report.providerId,
    name: report.providerName,
    mode: report.mode === "live" ? "LIVE" : "DEMO",
    sourceKind: report.mode === "live" ? "live" : "demo",
    quotedCurrency: "IRT",
    capabilities: { reportedAt: new Date(0).toISOString() } as JsonValue,
    complianceNote: "اعلام‌شده توسط کد منبع؛ برای جزئیات docs/COMPLIANCE.md را ببینید.",
    enabled: true,
  };
}

/** Deterministic hash of the request, so double-submits collapse. */
export function requestHash(input: {
  originCity: string;
  destinationCity: string;
  departDate: string;
  passengers: number;
  cabin: string;
  mode: string;
}): string {
  return [
    input.mode,
    input.originCity,
    input.destinationCity,
    input.departDate,
    `p${input.passengers}`,
    input.cabin,
  ].join("|");
}

function fareFactsOf(offer: FlightOffer): FareFacts {
  return {
    airlineCode: offer.airlineCode,
    flightNumber: offer.flightNumber,
    originAirport: offer.originAirport ?? offer.originCode,
    destinationAirport: offer.destinationAirport ?? offer.destinationCode,
    departDate: offer.departAt.slice(0, 10),
    cabin: offer.cabin,
    fareClass: offer.fare?.fareClass ?? null,
    baggage: baggageFacts(offer.baggage),
    refund: offer.refundable === null ? "unknown" : offer.refundable ? "refundable" : "non-refundable",
    ticketType: offer.fare?.ticketType ?? "unknown",
    marketingCarrier: null,
  };
}

function toOfferRow(offer: FlightOffer, searchId: string): FlightOfferCreateInput {
  const facts = fareFactsOf(offer);
  const key = offerKey(facts);
  return {
    // Idempotent identity: provider + fare-level key. Never random.
    id: offer.id,
    providerId: offer.providerId,
    searchId,
    rawOfferId: offer.provenance?.rawRecordId ?? null,
    offerKey: key,
    groupKey: offer.groupKey,
    airlineCode: offer.airlineCode,
    airlineName: offer.airlineName,
    flightNumber: offer.flightNumber,
    originAirport: offer.originAirport ?? null,
    destinationAirport: offer.destinationAirport ?? null,
    originCity: offer.originCode,
    destinationCity: offer.destinationCode,
    departAt: new Date(offer.departAt),
    arriveAt: new Date(offer.arriveAt),
    durationMinutes: offer.durationMinutes,
    stops: offer.stops,
    cabin: offer.cabin,
    fareClass: facts.fareClass,
    fareName: offer.fare?.fareName ?? null,
    ticketType: facts.ticketType,
    priceToman: BigInt(offer.price.toman),
    priceMinor: BigInt(offer.price.original.amount),
    currency: offer.price.original.currency,
    priceUnitScale: 1,
    priceConverted: offer.price.converted,
    baggageChecked:
      offer.baggage.checked === "included" ? "INCLUDED" : offer.baggage.checked === "not-included" ? "NOT_INCLUDED" : "UNKNOWN",
    baggageCheckedKg: offer.baggage.checkedKg,
    baggageCabinKg: offer.baggage.cabinKg,
    refundable: offer.refundable,
    seatsAvailable: offer.seatsAvailable ?? null,
    fareFreshness: offer.freshness ?? "unverified",
    priceObservedAt: new Date(offer.priceObservedAt ?? offer.fetchedAt),
    fetchedAt: new Date(offer.fetchedAt),
    lastVerifiedAt: offer.lastVerifiedAt ? new Date(offer.lastVerifiedAt) : null,
    completeness: offer.completeness ?? 0,
    offerUrl: offer.offerUrl,
    sellerLabel: offer.provenance?.sellerLabel ?? null,
    warnings: [...offer.warnings],
    segments: offer.segments as unknown as JsonValue,
    isLatest: true,
  };
}

function toObservationRow(
  offer: FlightOffer,
  searchId: string,
): PriceObservationRowInput {
  const facts = fareFactsOf(offer);
  const key = offerKey(facts);
  const departureDate = localDate(offer.departAt, offer.originCode);

  return {
    providerId: offer.providerId,
    offerKey: key,
    groupKey: offer.groupKey,
    routeKey: `${facts.originAirport}>${facts.destinationAirport}`,
    airlineCode: offer.airlineCode,
    flightNumber: offer.flightNumber,
    originAirport: facts.originAirport,
    destinationAirport: facts.destinationAirport,
    departDate: new Date(`${departureDate}T00:00:00.000Z`),
    cabin: offer.cabin,
    fareClass: facts.fareClass,
    baggageSignature: facts.baggage.join("+") || "?",
    ticketType: facts.ticketType,
    priceToman: BigInt(offer.price.toman),
    currency: offer.price.original.currency,
    observedAt: new Date(offer.priceObservedAt ?? offer.fetchedAt),
    freshness: offer.freshness ?? "unverified",
    searchId,
  };
}

/**
 * Persist one search atomically.
 *
 * History rule: a price observation is appended only when it differs from the newest
 * observation for the same `offerKey`, or when the newest one is older than
 * `FORCE_OBSERVATION_AFTER_MS` (so a flat price still produces an occasional
 * heartbeat rather than a dense line of identical points).
 */
const FORCE_OBSERVATION_AFTER_MS = 6 * 60 * 60_000;

export async function persistSearch(input: PersistSearchInput): Promise<PersistSearchResult> {
  try {
    return await persistSearchOnce(input);
  } catch (error) {
    const mapped = mapPrismaError(error);
    // A concurrent identical submit lost the race on (requestHash, startedAt). That is
    // exactly the case idempotency is for: the other transaction stored it, so treat this
    // as a dedupe rather than surfacing a unique-constraint error to the user.
    if (mapped instanceof DatabaseError && mapped.code === "unique-conflict") {
      const existing = await findRecentSearch(input);
      if (existing) {
        return {
          searchId: existing.id,
          offersWritten: 0,
          observationsWritten: 0,
          status: existing.status === "failed" ? "failed" : existing.status === "partial" ? "partial" : "ok",
          deduped: true,
        };
      }
    }
    throw mapped;
  }
}

async function findRecentSearch(input: PersistSearchInput): Promise<{ id: string; status: string } | null> {
  try {
    return await getDb().flightSearch.findFirst({
      where: {
        requestHash: requestHash({ ...input.query, mode: input.mode }),
        startedAt: { gte: new Date(input.startedAt.getTime() - DEDUPE_WINDOW_MS) },
      },
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true },
    });
  } catch {
    return null;
  }
}

async function persistSearchOnce(input: PersistSearchInput): Promise<PersistSearchResult> {
  const prisma = getDb();
  const hash = requestHash({ ...input.query, mode: input.mode });

  // Collapse a duplicate submit of the exact same request within a short window.
  const recent = await prisma.flightSearch.findFirst({
    where: { requestHash: hash, startedAt: { gte: new Date(input.startedAt.getTime() - DEDUPE_WINDOW_MS) } },
    orderBy: { startedAt: "desc" },
    select: { id: true, status: true },
  });
  if (recent) {
    return {
      searchId: recent.id,
      offersWritten: 0,
      observationsWritten: 0,
      status: recent.status === "failed" ? "failed" : recent.status === "partial" ? "partial" : "ok",
      deduped: true,
    };
  }

  const okProviders = input.reports.filter((report) => report.ok);
  const status: PersistSearchResult["status"] =
    input.reports.length === 0
      ? "failed"
      : okProviders.length === 0
        ? "failed"
        : okProviders.length < input.reports.filter((report) => report.mode === "live").length || input.offers.length === 0
          ? "partial"
          : "ok";

  const result = await withTransaction(async (rawTx) => {
    const tx = rawTx as unknown as TypedDb;

    // Providers referenced by these offers must exist first (FK).
    for (const report of input.reports) {
      const row = providerRowFromReport(report);
      await tx.liveProvider.upsert({ where: { id: row.id }, create: row, update: {} });
    }
    const search = await tx.flightSearch.create({
      data: {
        requestHash: hash,
        originCity: input.query.originCity,
        destinationCity: input.query.destinationCity,
        departDate: new Date(`${input.query.departDate}T00:00:00.000Z`),
        passengers: input.query.passengers,
        cabin: input.query.cabin,
        mode: input.mode,
        status,
        offerCount: input.offers.length,
        startedAt: input.startedAt,
        finishedAt: new Date(),
        durationMs: Date.now() - input.startedAt.getTime(),
        providerReport: input.reports as unknown as JsonValue,
      },
    });

    for (const report of input.reports) {
      await tx.providerFetchLog.create({
        data: {
          searchId: search.id,
          providerId: report.providerId,
          ok: report.ok,
          httpStatus: report.error?.httpStatus ?? null,
          latencyMs: report.latencyMs,
          retries: report.retries,
          rawCount: report.rawCount,
          acceptedCount: report.accepted,
          rejectedCount: report.rejected,
          errorCode: report.error?.code ?? null,
          errorSummary: report.error?.summaryFa ?? null,
          endpoint: null,
          fromCache: report.fromCache,
          fetchedAt: report.fetchedAt ? new Date(report.fetchedAt) : new Date(),
        },
      });
    }

    let offersWritten = 0;
    let observationsWritten = 0;

    for (const offer of input.offers) {
      const row = toOfferRow(offer, search.id);
      // Upsert on the natural key: re-seeing a product updates it, never duplicates.
      await tx.flightOffer.upsert({
        where: { providerId_offerKey: { providerId: row.providerId, offerKey: row.offerKey } },
        create: row,
        update: {
          searchId: search.id,
          priceToman: row.priceToman,
          priceMinor: row.priceMinor,
          currency: row.currency,
          priceConverted: row.priceConverted,
          fareFreshness: row.fareFreshness,
          priceObservedAt: row.priceObservedAt,
          fetchedAt: row.fetchedAt,
          lastVerifiedAt: row.lastVerifiedAt,
          completeness: row.completeness,
          warnings: row.warnings,
          segments: row.segments,
          sellerLabel: row.sellerLabel,
          isLatest: true,
        },
      });
      offersWritten += 1;

      const observation = toObservationRow(offer, search.id);
      const last = await tx.priceObservation.findFirst({
        where: { offerKey: observation.offerKey },
        orderBy: { observedAt: "desc" },
        select: { priceToman: true, observedAt: true },
      });

      const priceChanged = !last || last.priceToman !== observation.priceToman;
      const stale = !last || observation.observedAt.getTime() - last.observedAt.getTime() > FORCE_OBSERVATION_AFTER_MS;

      if (priceChanged || stale) {
        await tx.priceObservation.create({ data: observation });
        observationsWritten += 1;
      }
    }

    // Older rows for this request are no longer "latest" — the UI reads only latest.
    await tx.flightOffer.updateMany({
      where: { searchId: { not: search.id }, isLatest: true, originCity: input.query.originCity, destinationCity: input.query.destinationCity },
      data: { isLatest: false },
    });

    return { searchId: search.id, offersWritten, observationsWritten };
  });

  return { ...result, status, deduped: false };
}
