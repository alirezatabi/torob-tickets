/**
 * The slice of the Prisma client this project uses.
 *
 * Why a hand-written façade: `prisma generate` needs to download query-engine
 * binaries from `binaries.prisma.sh`, which is not reachable from every build
 * environment (and is not reachable from this repo's CI sandbox). Without
 * generation, `@prisma/client` exports no model types, so importing
 * `Prisma.FlightOfferCreateInput` directly would make `tsc` fail on a machine that
 * simply has not run `db:generate` yet.
 *
 * Consequences:
 *   • this file is the *only* place that knows the delegate surface;
 *   • after `npm run db:generate`, `PrismaClient` structurally satisfies `TypedDb`,
 *     so the real generated types still apply at the call site;
 *   • the field names below are checked against `prisma/schema.prisma` by hand and by
 *     `npm run db:check` (which runs `prisma validate`).
 *
 * Keep this file boring: one interface per table, only the methods used.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface ProviderFetchLogRow {
  id?: string;
  searchId?: string | null;
  providerId: string;
  ok: boolean;
  httpStatus?: number | null;
  latencyMs: number;
  retries?: number;
  rawCount?: number;
  acceptedCount?: number;
  rejectedCount?: number;
  errorCode?: string | null;
  errorSummary?: string | null;
  endpoint?: string | null;
  fromCache?: boolean;
  fetchedAt?: Date;
}

export interface FlightOfferViewRow {
  id: string;
  providerId: string;
  searchId?: string | null;
  rawOfferId?: string | null;
  offerKey: string;
  groupKey: string;
  airlineCode: string;
  airlineName: string;
  flightNumber?: string | null;
  originAirport?: string | null;
  destinationAirport?: string | null;
  originCity: string;
  destinationCity: string;
  departAt: Date;
  arriveAt: Date;
  durationMinutes: number;
  stops: number;
  cabin: string;
  fareClass?: string | null;
  fareName?: string | null;
  ticketType: string;
  priceToman: bigint;
  priceMinor: bigint;
  currency: string;
  priceUnitScale: number;
  priceConverted: boolean;
  baggageChecked: "INCLUDED" | "NOT_INCLUDED" | "UNKNOWN";
  baggageCheckedKg?: number | null;
  baggageCabinKg?: number | null;
  refundable?: boolean | null;
  seatsAvailable?: number | null;
  fareFreshness: string;
  priceObservedAt: Date;
  fetchedAt: Date;
  lastVerifiedAt?: Date | null;
  completeness: number;
  offerUrl: string;
  sellerLabel?: string | null;
  warnings: string[];
  segments?: JsonValue | null;
  isLatest: boolean;
}

export type FlightOfferCreateInput = FlightOfferViewRow;
export type FlightOfferUpdateInput = Partial<Omit<FlightOfferViewRow, "id" | "providerId" | "offerKey">>;

export interface PriceObservationCreateInput {
  id?: string;
  providerId: string;
  offerKey: string;
  groupKey: string;
  routeKey: string;
  airlineCode: string;
  flightNumber?: string | null;
  originAirport?: string | null;
  destinationAirport?: string | null;
  departDate: Date;
  cabin: string;
  fareClass?: string | null;
  baggageSignature: string;
  ticketType: string;
  priceToman: bigint;
  currency: string;
  observedAt?: Date;
  freshness: string;
  searchId?: string | null;
}

export interface PriceObservationViewRow extends PriceObservationCreateInput {
  id: string;
  observedAt: Date;
}

/** Always present once constructed by the persistence layer. */
export type PriceObservationRowInput = PriceObservationCreateInput & { observedAt: Date };

export interface FlightSearchCreateInput {
  requestHash: string;
  originCity: string;
  destinationCity: string;
  departDate: Date;
  passengers: number;
  cabin: string;
  mode: "LIVE" | "DEMO";
  status: string;
  offerCount: number;
  startedAt: Date;
  finishedAt?: Date | null;
  durationMs?: number | null;
  providerReport?: JsonValue | null;
}

export type Where = Record<string, unknown>;

/**
 * Structural type of the delegates we call. Optional so `db` can be a partial fake in
 * tests; production code always has all of them.
 */
export interface TypedDb {
  flightSearch: {
    create(args: { data: FlightSearchCreateInput }): Promise<{ id: string }>;
    findFirst(args?: {
      where?: Where;
      orderBy?: Where;
      select?: Where;
    }): Promise<{ id: string; status: string; startedAt?: Date } | null>;
    findUnique(args: { where: Where; select?: Where }): Promise<Record<string, unknown> | null>;
    update(args: { where: Where; data: Where }): Promise<unknown>;
  };
  providerFetchLog: {
    create(args: { data: ProviderFetchLogRow }): Promise<unknown>;
    findMany(args?: { where?: Where; orderBy?: Where; take?: number }): Promise<ProviderFetchLogRow[]>;
  };
  flightOffer: {
    upsert(args: {
      where: { providerId_offerKey: { providerId: string; offerKey: string } };
      create: FlightOfferCreateInput;
      update: FlightOfferUpdateInput;
    }): Promise<FlightOfferViewRow>;
    findMany(args?: { where?: Where; orderBy?: Where; take?: number; select?: Where }): Promise<FlightOfferViewRow[]>;
    updateMany(args: { where: Where; data: Where }): Promise<{ count: number }>;
  };
  priceObservation: {
    create(args: { data: PriceObservationCreateInput }): Promise<unknown>;
    findFirst(args?: {
      where?: Where;
      orderBy?: Where;
      select?: Where;
    }): Promise<{ priceToman: bigint; observedAt: Date } | null>;
    findMany(args?: { where?: Where; orderBy?: Where; take?: number }): Promise<PriceObservationViewRow[]>;
  };
  searchSnapshot: {
    findFirst(args?: { where?: Where; orderBy?: Where }): Promise<Record<string, unknown> | null>;
    create(args: { data: Where }): Promise<unknown>;
    deleteMany(args?: { where?: Where }): Promise<{ count: number }>;
  };
}
