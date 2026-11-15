import type { FlightOffer } from "@/domain/flight";
import { baggageFacts, localDate } from "@/modules/catalog/fare-facts";
import { offerKey, type FareFacts } from "@/modules/catalog/offer-identity";
import { getDb, isDatabaseConfigured } from "@/modules/db/prisma";
import { withTransaction, type TransactionCapable } from "@/modules/db/transaction";
import type { PriceObservationRowInput, TypedDb } from "@/modules/db/client-types";

const HOURLY_HEARTBEAT_MS = 60 * 60_000;

export interface CrawlHistoryOptions {
  observedAt?: Date;
  /** Injectable transaction client for deterministic tests. */
  client?: TransactionCapable;
}

/**
 * Append one price point per source seller + exact fare when the price changes, or
 * at least once per hour even when it stays flat. Safarmarket's seller id is the
 * provider key, so two sellers of the same flight never suppress one another.
 */
export async function recordCrawlPriceHistory(
  offers: FlightOffer[],
  options: CrawlHistoryOptions = {},
): Promise<number> {
  if (offers.length === 0) return 0;
  if (!options.client && !isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is required to persist hourly crawl price history");
  }
  const observedAt = options.observedAt ?? new Date();
  return withTransaction(async (rawTx) => {
    const tx = rawTx as unknown as TypedDb;
    let written = 0;
    for (const offer of offers) {
      const row = toObservation(offer, observedAt);
      const last = await tx.priceObservation.findFirst({
        where: { providerId: row.providerId, offerKey: row.offerKey },
        orderBy: { observedAt: "desc" },
        select: { priceToman: true, observedAt: true },
      });
      const changed = !last || last.priceToman !== row.priceToman;
      const heartbeatDue = !last || observedAt.getTime() - last.observedAt.getTime() >= HOURLY_HEARTBEAT_MS;
      if (changed || heartbeatDue) {
        await tx.priceObservation.create({ data: row });
        written += 1;
      }
    }
    return written;
  }, { ...(options.client ? { client: options.client } : {}) });
}

function fareFactsOf(offer: FlightOffer): FareFacts {
  return {
    airlineCode: offer.airlineCode,
    flightNumber: offer.flightNumber,
    originAirport: offer.originAirport ?? offer.originCode,
    destinationAirport: offer.destinationAirport ?? offer.destinationCode,
    departDate: localDate(offer.departAt, offer.originCode),
    cabin: offer.cabin,
    fareClass: offer.fare?.fareClass ?? null,
    baggage: baggageFacts(offer.baggage),
    refund: offer.refundable === null ? "unknown" : offer.refundable ? "refundable" : "non-refundable",
    ticketType: offer.fare?.ticketType ?? "unknown",
    marketingCarrier: null,
  };
}

function toObservation(offer: FlightOffer, observedAt: Date): PriceObservationRowInput {
  const facts = fareFactsOf(offer);
  const departureDate = localDate(offer.departAt, offer.originCode);
  return {
    providerId: offer.providerId,
    offerKey: offerKey(facts),
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
    observedAt,
    freshness: "unverified",
    searchId: null,
  };
}

/** Small adapter to make it explicit that this module only needs the configured DB. */
export async function assertCrawlHistoryDatabase(): Promise<void> {
  if (!isDatabaseConfigured()) throw new Error("DATABASE_URL is required; refusing to run continuous crawling without durable hourly history");
  const db = await getDb();
  await db.providerFetchLog.findMany({ take: 0 });
}
