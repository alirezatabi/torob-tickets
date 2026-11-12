/**
 * Live provider contract.
 *
 * The existing demo adapters implement the simpler `ProviderAdapter` (search +
 * normalize). Live sources need more: they must declare their *capabilities* so the
 * UI and dedupe can stay honest (e.g. Sepehr360 has no flight number, so its offers
 * must never be merged by number), and they must report *why* they failed instead of
 * throwing opaque errors.
 *
 * A connector is responsible for exactly two things:
 *   1. `search`   — talk to the source and return its raw records + fetch metadata;
 *   2. `normalize`— map each raw record to the internal offer, or reject it with a reason.
 *
 * Everything else (currency, freshness, dedupe, ranking, persistence) is shared.
 */

import type { FlightOffer } from "@/domain/flight";
import type { TripQuery } from "@/domain/trip";
import type { ProviderErrorInfo } from "@/modules/providers/shared/errors";
import type { NormalizationIssue } from "@/providers/types";
import type { Logger } from "@/modules/providers/shared/logger";

export type ProviderSourceKind = "html" | "api" | "demo";

export interface ProviderCapabilities {
  /** The source tells us the flight number. Without it, cross-provider merges are refused. */
  hasFlightNumber: boolean;
  hasAirportCodes: boolean;
  hasSegments: boolean;
  /** Per-fare-class prices (economy/business are separate rows). */
  hasFareClass: boolean;
  hasBaggage: boolean;
  hasRefundTerms: boolean;
  /** The source gives a URL that opens *this* offer (not just the route). */
  hasOfferDeepLink: boolean;
  /** The source states availability/seat count. */
  hasAvailability: boolean;
  /** Per-passenger prices. */
  hasPassengerPrices: boolean;
}

export interface FreshnessPolicy {
  /** Below this age the price may be called "fresh". */
  freshMs: number;
  /** Below this age it is "possibly stale". Beyond it: unverified. */
  staleMs: number;
  /**
   * Can a price from this source ever be described as "available"?
   * Only when the source states availability we may claim it.
   */
  canClaimAvailability: boolean;
  /** Documented reason, shown in the README and the offer tooltip. */
  noteFa: string;
}

export interface ProviderSearchRequest {
  /** The user's normalized query (already validated). */
  query: TripQuery;
  /** Cities requested (THR, MHD, …). */
  originCity: string;
  destinationCity: string;
  /** Airports to cover, best first (THR, IKA for Tehran). */
  originAirports: string[];
  destinationAirports: string[];
  /** Civil departure date in the origin's timezone: YYYY-MM-DD. */
  departDate: string;
  passengers: number;
  cabin: "economy" | "premium" | "business";
  international: boolean;
}

export interface ProviderContext {
  signal: AbortSignal;
  logger: Logger;
  now: () => Date;
  /** Monotonic-ish budget for the whole provider call. */
  budgetMs: number;
}

export interface FetchMeta {
  providerId: string;
  fetchedAt: string;
  latencyMs: number;
  httpStatus: number | null;
  retries: number;
  fromCache: boolean;
  /** Endpoint the data came from (no secrets — safe for server logs). */
  endpoint: string;
  /** The source's own "as of" timestamp when it publishes one. */
  sourceUpdatedAt: string | null;
}

export interface ProviderSearchResult<TRaw> {
  records: TRaw[];
  meta: FetchMeta;
  /** Rows the parser understood structurally (before normalization filters). */
  rawCount: number;
  warnings: string[];
}

export interface NormalizedBatch {
  offers: FlightOffer[];
  issues: NormalizationIssue[];
}

export interface LiveProviderAdapter<TRaw> {
  readonly id: string;
  readonly name: string;
  readonly mode: "live";
  readonly sourceKind: ProviderSourceKind;
  /** Persian one-liner shown under the provider name. */
  readonly description: string;
  readonly quotedCurrency: "IRT" | "IRR" | "USD" | "EUR";
  readonly capabilities: ProviderCapabilities;
  readonly freshness: FreshnessPolicy;
  /** What this source is allowed to do, for the README and the UI tooltip. */
  readonly complianceNoteFa: string;
  /** True when the connector has everything it needs (credentials, allowlist, flag). */
  isConfigured(): boolean;
  search(request: ProviderSearchRequest, ctx: ProviderContext): Promise<ProviderSearchResult<TRaw>>;
  normalize(records: TRaw[], request: ProviderSearchRequest, meta: FetchMeta): NormalizedBatch;
}

export interface ProviderRunReport {
  providerId: string;
  providerName: string;
  mode: "live" | "demo";
  ok: boolean;
  /** Offers that survived normalization. */
  accepted: number;
  /** Rows rejected by normalization. */
  rejected: number;
  /** Raw rows returned by the source. */
  rawCount: number;
  latencyMs: number;
  retries: number;
  error: ProviderErrorInfo | null;
  fetchedAt: string | null;
  fromCache: boolean;
  /**
   * Non-fatal things the connector wants on the record — which endpoint a feed came from,
   * which facts the source does not publish. Evidence, not decoration.
   */
  warnings?: string[];
}
