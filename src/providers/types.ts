import type { FlightOffer } from "@/domain/flight";
import type { TripQuery } from "@/domain/trip";

/**
 * The seam that makes the aggregator extensible.
 *
 * A provider adapter does exactly two things:
 *  1. `search` — talk to the provider (HTTP, SDK, CSV, …) and return *its* raw shape.
 *  2. `normalize` — translate one raw record into the internal `FlightOffer`.
 *
 * Search, dedupe and ranking never know which provider produced an offer, so a
 * new provider (or a train provider) is additive.
 */
export interface ProviderAdapter<TRaw> {
  readonly id: string;
  readonly name: string;
  readonly mode: "demo" | "live";
  /** Human-readable note shown in the UI's provider list. */
  readonly description: string;
  /** Currency the provider quotes in, for transparency. */
  readonly quotedCurrency: "IRR" | "IRT" | "USD" | "EUR";
  search(query: TripQuery): Promise<TRaw[]>;
  normalize(raw: TRaw[], query: TripQuery): NormalizationResult;
}

export interface NormalizationResult {
  offers: FlightOffer[];
  /** Per-record problems (bad rows are skipped, never silently fixed). */
  issues: NormalizationIssue[];
}

export interface NormalizationIssue {
  providerId: string;
  rawId: string | null;
  code: "invalid-price" | "invalid-time" | "unknown-city" | "missing-route";
  message: string;
}

export interface ProviderHealth {
  id: string;
  name: string;
  mode: "demo" | "live";
  description: string;
  quotedCurrency: string;
  ok: boolean;
  returned: number;
  rejected: number;
  latencyMs: number;
  error?: string;
}
