/**
 * Optional persistence (Postgres via Prisma).
 *
 * The demo must run with nothing configured, so this module is written as a
 * strictly best-effort side effect:
 *   • no `DATABASE_URL`  → every call is a no-op,
 *   • client not generated / DB unreachable → errors are swallowed and logged once.
 *
 * The Prisma client is imported lazily so a missing generated client can never
 * break a page render or a build.
 */

import type { SearchOutcome } from "@/providers/search";
import type { RankedResult } from "@/ranking/score";
import { disconnectPrisma, getPrisma, isDatabaseConfigured } from "@/modules/db/prisma";

export function isPersistenceEnabled(): boolean {
  return isDatabaseConfigured();
}

/**
 * One client for the whole process, created by `modules/db/prisma` (which owns the
 * Prisma 7 driver adapter). Persistence is strictly best-effort: if the generated client
 * or the database is missing, `getClient()` returns null and every write becomes a no-op.
 */
async function getClient(): Promise<PrismaLike | null> {
  if (!isPersistenceEnabled()) return null;
  try {
    return (await getPrisma()) as unknown as PrismaLike;
  } catch (error) {
    logOnce(`Prisma client unavailable (${error instanceof Error ? error.message : "unknown"}).`);
    return null;
  }
}

type PrismaLike = {
  searchLog: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
  offerSnapshot: {
    createMany(args: { data: Record<string, unknown>[] }): Promise<unknown>;
    deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
  };
  $disconnect(): Promise<void>;
};

let warned = false;

function logOnce(message: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[persistence] ${message} Continuing without persistence.`);
}

const BAGGAGE_STATE = {
  included: "INCLUDED",
  "not-included": "NOT_INCLUDED",
  unknown: "UNKNOWN",
} as const;

/**
 * Record a completed search: the structured intent, how many offers were found and
 * immutable snapshots of every normalized offer (provenance for "last updated").
 * Never throws, never blocks the caller.
 */
export async function recordSearch(outcome: SearchOutcome, ranked: RankedResult): Promise<void> {
  const client = await getClient();
  if (!client) return;

  const { query } = outcome;

  try {
    await client.offerSnapshot.deleteMany({
      where: {
        originCode: query.originCode,
        destinationCode: query.destinationCode,
        departAt: {
          gte: new Date(`${query.departDate}T00:00:00.000Z`),
          lt: new Date(`${query.departDate}T23:59:59.999Z`),
        },
      },
    });

    if (outcome.offers.length > 0) {
      await client.offerSnapshot.createMany({
        data: outcome.offers.map((offer) => ({
          providerId: offer.providerId,
          rawOfferId: offer.id.split(":")[1] ?? null,
          groupKey: offer.groupKey,
          airlineCode: offer.airlineCode,
          flightNumber: offer.flightNumber,
          originCode: offer.originCode,
          destinationCode: offer.destinationCode,
          departAt: new Date(offer.departAt),
          arriveAt: new Date(offer.arriveAt),
          durationMinutes: offer.durationMinutes,
          stops: offer.stops,
          priceToman: offer.price.toman,
          originalAmount: offer.price.original.amount,
          originalCurrency: offer.price.original.currency,
          baggageChecked: BAGGAGE_STATE[offer.baggage.checked],
          baggageCheckedKg: offer.baggage.checkedKg,
          refundable: offer.refundable,
          cabin: offer.cabin,
          offerUrl: offer.offerUrl,
          providerUpdatedAt: new Date(offer.providerUpdatedAt),
          fetchedAt: new Date(offer.fetchedAt),
          warnings: offer.warnings,
        })),
      });
    }

    await client.searchLog.create({
      data: {
        rawText: query.rawText ?? null,
        originCode: query.originCode,
        destinationCode: query.destinationCode,
        departDate: new Date(`${query.departDate}T00:00:00.000Z`),
        passengers: query.passengers,
        intent: query.filters as unknown as Record<string, unknown>,
        source: query.rawText ? "natural-language" : "form",
        resultCount: outcome.offers.length,
        bestOfferId: ranked.best?.offer.id ?? null,
      },
    });
  } catch (error) {
    logOnce(`Write failed (${error instanceof Error ? error.message : "unknown"}).`);
  }
}

/** Test/CLI helper. */
export async function disconnectPersistence(): Promise<void> {
  await disconnectPrisma().catch(() => undefined);
}
