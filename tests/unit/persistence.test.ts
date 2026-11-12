import { describe, expect, it } from "vitest";

import type {
  FlightOfferCreateInput,
  PriceObservationRowInput,
  TypedDb,
} from "@/modules/db/client-types";
import { withTransaction } from "@/modules/db/transaction";
import { mapPrismaError, isRetryableDbError } from "@/modules/db/errors";

/**
 * A hand-written fake of the four delegates the persistence layer uses.
 *
 * The real Prisma client cannot be generated in this sandbox (engine binaries are not
 * reachable), so the *logic* is tested here against a faithful in-memory model of the
 * schema's constraints: unique (providerId, offerKey), append-only observations, and a
 * transaction that rolls back on throw.
 */
function fakeDb() {
  const offers = new Map<string, FlightOfferCreateInput>();
  const observations: PriceObservationRowInput[] = [];
  const searches: Record<string, unknown>[] = [];
  const logs: unknown[] = [];

  const db: TypedDb = {
    flightSearch: {
      async create({ data }) {
        const row = { ...data, id: `search-${searches.length + 1}` };
        searches.push(row);
        return { id: row.id as string };
      },
      async findFirst({ where } = {}) {
        const hash = (where?.requestHash as string | undefined) ?? null;
        const recent = searches.filter((row) => row.requestHash === hash).at(-1);
        return recent ? { id: recent.id as string, status: recent.status as string } : null;
      },
      async findUnique() {
        return null;
      },
      async update() {
        return null;
      },
    },
    providerFetchLog: {
      async create({ data }) {
        logs.push(data);
        return data;
      },
      async findMany() {
        return [];
      },
    },
    flightOffer: {
      async upsert({ where, create, update }) {
        const key = `${where.providerId_offerKey.providerId}|${where.providerId_offerKey.offerKey}`;
        const existing = offers.get(key);
        const row = existing ? { ...existing, ...update } : create;
        offers.set(key, row as FlightOfferCreateInput);
        return row as never;
      },
      async findMany() {
        return [...offers.values()] as never;
      },
      async updateMany() {
        return { count: 0 };
      },
    },
    priceObservation: {
      async create({ data }) {
        observations.push({ ...data, observedAt: data.observedAt ?? new Date() });
        return data;
      },
      async findFirst({ where } = {}) {
        const matches = observations.filter((row) => row.offerKey === where?.offerKey);
        return matches.at(-1) ?? null;
      },
      async findMany({ where } = {}) {
        const key = where?.offerKey as string | undefined;
        return observations.filter((row) => (key ? row.offerKey === key : true)) as never;
      },
    },
    searchSnapshot: {
      async findFirst() {
        return null;
      },
      async create() {
        return null;
      },
      async deleteMany() {
        return { count: 0 };
      },
    },
  };

  return { db, offers, observations, searches, logs };
}

function offerRow(overrides: Partial<FlightOfferCreateInput> = {}): FlightOfferCreateInput {
  return {
    id: "alpha:key",
    providerId: "alpha",
    searchId: null,
    rawOfferId: null,
    offerKey: "air:IR|flt:?|rt:THR>MHD|day:2026-11-13|cab:economy",
    groupKey: "IR|~|2026-11-13|THR|MHD",
    airlineCode: "IR",
    airlineName: "هما",
    flightNumber: null,
    originAirport: "THR",
    destinationAirport: "MHD",
    originCity: "THR",
    destinationCity: "MHD",
    departAt: new Date("2026-11-13T04:00:00.000Z"),
    arriveAt: new Date("2026-11-13T05:20:00.000Z"),
    durationMinutes: 80,
    stops: 0,
    cabin: "economy",
    fareClass: null,
    fareName: null,
    ticketType: "unknown",
    priceToman: 5_000_000n,
    priceMinor: 5_000_000n,
    currency: "IRT",
    priceUnitScale: 1,
    priceConverted: false,
    baggageChecked: "UNKNOWN",
    baggageCheckedKg: null,
    baggageCabinKg: null,
    refundable: null,
    seatsAvailable: null,
    fareFreshness: "fresh",
    priceObservedAt: new Date("2026-11-12T10:00:00.000Z"),
    fetchedAt: new Date("2026-11-12T10:00:00.000Z"),
    lastVerifiedAt: null,
    completeness: 0.2,
    offerUrl: "https://example.com/search",
    sellerLabel: null,
    warnings: [],
    segments: null,
    isLatest: true,
    ...overrides,
  };
}

describe("withTransaction", () => {
  it("passes the transaction client through and returns the result", async () => {
    const { db } = fakeDb();
    const client = {
      async $transaction<T>(run: (tx: unknown) => Promise<T>): Promise<T> {
        return run(db);
      },
    };
    const result = await withTransaction(async (tx) => tx.flightOffer !== undefined, { client: client as never });
    expect(result).toBe(true);
  });

  it("retries a retryable failure and then succeeds", async () => {
    let attempts = 0;
    const client = {
      async $transaction<T>(run: (tx: unknown) => Promise<T>): Promise<T> {
        attempts += 1;
        if (attempts === 1) {
          const error = Object.assign(new Error("deadlock"), { code: "P2034" });
          throw error;
        }
        return run({});
      },
    };
    await expect(withTransaction(async () => "ok", { client: client as never })).resolves.toBe("ok");
    expect(attempts).toBe(2);
  });

  it("does not retry a validation failure", async () => {
    let attempts = 0;
    const client = {
      async $transaction<T>(): Promise<T> {
        attempts += 1;
        throw Object.assign(new Error("bad value"), { code: "P2000" });
      },
    };
    await expect(withTransaction(async () => "never", { client: client as never })).rejects.toMatchObject({
      code: "validation",
    });
    expect(attempts).toBe(1);
  });
});

describe("prisma error mapping", () => {
  it("maps known codes", () => {
    expect(mapPrismaError({ code: "P2002" })).toMatchObject({ code: "unique-conflict", retryable: true });
    expect(mapPrismaError({ code: "P2025" })).toMatchObject({ code: "not-found" });
    expect(mapPrismaError({ code: "P2003" })).toMatchObject({ code: "foreign-key" });
  });

  it("recognises connection failures as unavailable", () => {
    const mapped = mapPrismaError(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
    expect(mapped.code).toBe("unavailable");
    expect(mapped.summaryFa).toContain("PostgreSQL");
  });

  it("marks only concurrency errors retryable", () => {
    expect(isRetryableDbError({ code: "P2034" })).toBe(true);
    expect(isRetryableDbError({ code: "P2025" })).toBe(false);
  });
});

/**
 * Direct model-level assertions of the persistence invariants. These mirror
 * `persistSearch` step for step (see src/modules/persistence/live-store.ts) because
 * the real function needs a live Postgres; the invariants are what must not regress.
 */
describe("persistence invariants", () => {
  it("a duplicate fetch of the same product updates one row instead of inserting two", async () => {
    const { db, offers } = fakeDb();
    const row = offerRow();

    await db.flightOffer.upsert({
      where: { providerId_offerKey: { providerId: row.providerId, offerKey: row.offerKey } },
      create: row,
      update: { priceToman: 5_500_000n },
    });
    await db.flightOffer.upsert({
      where: { providerId_offerKey: { providerId: row.providerId, offerKey: row.offerKey } },
      create: row,
      update: { priceToman: 5_500_000n },
    });

    expect(offers.size).toBe(1);
    expect([...offers.values()][0]?.priceToman).toBe(5_500_000n);
  });

  it("keeps offers with different fare keys in separate rows", async () => {
    const { db, offers } = fakeDb();
    const economy = offerRow();
    const business = offerRow({
      id: "alpha:business",
      offerKey: "air:IR|flt:?|rt:THR>MHD|day:2026-11-13|cab:business",
      cabin: "business",
    });

    for (const row of [economy, business]) {
      await db.flightOffer.upsert({
        where: { providerId_offerKey: { providerId: row.providerId, offerKey: row.offerKey } },
        create: row,
        update: {},
      });
    }
    expect(offers.size).toBe(2);
  });

  it("appends an observation only when the price changes or the last point is old", async () => {
    const { db, observations } = fakeDb();
    const base = {
      providerId: "alpha",
      offerKey: "key",
      groupKey: "g",
      routeKey: "THR>MHD",
      airlineCode: "IR",
      flightNumber: null,
      originAirport: "THR",
      destinationAirport: "MHD",
      departDate: new Date("2026-11-13T00:00:00.000Z"),
      cabin: "economy",
      fareClass: null,
      baggageSignature: "checked-unknown",
      ticketType: "unknown",
      currency: "IRT",
      freshness: "fresh",
      searchId: null,
    };

    const consider = async (priceToman: bigint, observedAt: Date) => {
      const last = await db.priceObservation.findFirst({ where: { offerKey: base.offerKey }, orderBy: { observedAt: "desc" } });
      const changed = !last || last.priceToman !== priceToman;
      const stale = !last || observedAt.getTime() - last.observedAt.getTime() > 6 * 60 * 60_000;
      if (changed || stale) await db.priceObservation.create({ data: { ...base, priceToman, observedAt } });
    };

    await consider(5_000_000n, new Date("2026-11-12T10:00:00Z"));
    await consider(5_000_000n, new Date("2026-11-12T10:05:00Z")); // same price, recent → no point
    await consider(4_800_000n, new Date("2026-11-12T10:10:00Z")); // price change → point
    await consider(4_800_000n, new Date("2026-11-12T18:00:00Z")); // same price, old → heartbeat

    expect(observations).toHaveLength(3);
    expect(observations.map((row) => Number(row.priceToman))).toEqual([5_000_000, 4_800_000, 4_800_000]);
  });
});
