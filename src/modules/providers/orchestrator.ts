/**
 * Search orchestrator — the seam between "the user asked for a trip" and "providers".
 *
 * Invariants that this file exists to guarantee:
 *
 *   1. **Isolation.** A provider that throws, hangs or returns garbage produces a
 *      failed `ProviderRunReport` and nothing else. It can never fail the search.
 *   2. **Bounded work.** Each provider gets its own timeout, at most one retry (inside
 *      the HttpClient), a token bucket and a TTL cache. Concurrency is capped so a
 *      page view never opens a dozen sockets.
 *   3. **One normalization path.** Every raw record goes through the shared live
 *      normalizer, so money/freshness/identity rules cannot drift between providers.
 *   4. **Honest aggregation.** Results are deduped within a provider, grouped across
 *      providers by *display* identity, ranked by the deterministic core, and only
 *      then presented. Demo and live offers are grouped separately.
 *   5. **Proof.** The orchestrator returns per-provider evidence (latency, retries,
 *      raw/accepted/rejected counts, error codes) that the API exposes and the
 *      persistence layer stores.
 */

import type { FlightOffer, OfferGroup } from "@/domain/flight";
import type { TripQuery } from "@/domain/trip";
import { groupOffers } from "@/dedupe/group";
import { airportsForCity } from "@/modules/airports";
import type {
  LiveProviderAdapter,
  ProviderRunReport,
  ProviderSearchRequest,
} from "@/modules/providers/contracts/provider";
import { asProviderError, ProviderError, type ProviderErrorCode } from "@/modules/providers/shared/errors";
import { createLogger, type Logger } from "@/modules/providers/shared/logger";
import { TtlCache, providerCacheKey } from "@/modules/providers/shared/cache";
import { baggageFacts } from "@/modules/providers/shared/normalize-offer";
import { offerKey } from "@/modules/live/offer-identity";
import type { NormalizationIssue } from "@/providers/types";

export interface OrchestratorOptions {
  /** Providers to consult. Order does not affect ranking. */
  providers: LiveProviderAdapter<unknown>[];
  /** Max providers running at once. */
  concurrency?: number;
  /** Hard cap for a whole search, independent of per-provider timeouts. */
  searchBudgetMs?: number;
  logger?: Logger;
  now?: () => Date;
  /** Cache TTL for provider responses (default 90 s). */
  cacheTtlMs?: number;
  /** Injectable cache for tests. */
  cache?: TtlCache<unknown>;
}

export interface SearchOutcome {
  query: TripQuery;
  offers: FlightOffer[];
  groups: OfferGroup[];
  reports: ProviderRunReport[];
  issues: NormalizationIssue[];
  warnings: string[];
  /** True when at least one live provider returned offers. */
  hasLiveOffers: boolean;
  elapsedMs: number;
}

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_BUDGET_MS = 15_000;

export class SearchOrchestrator {
  private readonly options: Required<Omit<OrchestratorOptions, "cache" | "logger">> & {
    logger: Logger;
    cache: TtlCache<unknown>;
  };

  constructor(options: OrchestratorOptions) {
    this.options = {
      concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
      searchBudgetMs: options.searchBudgetMs ?? DEFAULT_BUDGET_MS,
      providers: options.providers,
      now: options.now ?? (() => new Date()),
      cacheTtlMs: options.cacheTtlMs ?? 90_000,
      logger: options.logger ?? createLogger("orchestrator"),
      cache: options.cache ?? new TtlCache<unknown>(options.cacheTtlMs ?? 90_000),
    };
  }

  /** Build the provider-facing request from a normalized trip query. */
  buildRequest(query: TripQuery): ProviderSearchRequest {
    const international = isInternational(query.originCode, query.destinationCode);
    return {
      query,
      originCity: query.originCode,
      destinationCity: query.destinationCode,
      originAirports: airportsForCity(query.originCode, { international }),
      destinationAirports: airportsForCity(query.destinationCode, { international }),
      departDate: query.departDate,
      passengers: query.passengers ?? 1,
      cabin: (query.cabin as ProviderSearchRequest["cabin"]) ?? "economy",
      international,
    };
  }

  async search(query: TripQuery): Promise<SearchOutcome> {
    const startedAt = Date.now();
    const now = this.options.now;
    const request = this.buildRequest(query);
    const deadline = new AbortController();
    const budgetTimer = setTimeout(() => deadline.abort(), this.options.searchBudgetMs);

    const reports: ProviderRunReport[] = [];
    const issues: NormalizationIssue[] = [];
    const warnings: string[] = [];
    const offers: FlightOffer[] = [];

    try {
      // Thunks, not promises: a promise would start the request immediately and the
      // concurrency cap would be decorative.
      const runs = this.options.providers.map(
        (provider) => () => this.runProvider(provider, request, deadline.signal, query.departDate),
      );

      for (const outcome of await runWithConcurrency(runs, this.options.concurrency)) {
        reports.push(outcome.report);
        issues.push(...outcome.issues);
        warnings.push(...outcome.warnings);
        offers.push(...outcome.offers);
      }
    } finally {
      clearTimeout(budgetTimer);
    }

    // —— intra-provider dedupe: same provider, same product, keep the cheapest ——
    const deduped = dedupeSameOffer(offers, warnings);

    // —— cross-provider grouping: same flight, different sellers ——
    const groups = groupOffers(deduped);

    const hasLiveOffers = deduped.some((offer) => offer.dataSource === "live");
    if (!hasLiveOffers && this.options.providers.length > 0) {
      warnings.push("no-live-offers");
    }

    this.options.logger.info("search.done", {
      providers: reports.length,
      failed: reports.filter((report) => !report.ok).length,
      offers: deduped.length,
      groups: groups.length,
      ms: Date.now() - startedAt,
      at: now().toISOString(),
    });

    return {
      query,
      offers: deduped,
      groups,
      reports,
      issues,
      warnings,
      hasLiveOffers,
      elapsedMs: Date.now() - startedAt,
    };
  }

  /**
   * Run one provider with full isolation. Every failure mode — including a bug in a
   * parser — becomes a report, never an exception.
   */
  private async runProvider(
    provider: LiveProviderAdapter<unknown>,
    request: ProviderSearchRequest,
    signal: AbortSignal,
    departDate: string,
  ): Promise<{
    report: ProviderRunReport;
    offers: FlightOffer[];
    issues: NormalizationIssue[];
    warnings: string[];
  }> {
    const startedAt = Date.now();
    const base = {
      providerId: provider.id,
      providerName: provider.name,
      mode: provider.mode,
    };

    if (!provider.isConfigured()) {
      return {
        report: {
          ...base,
          ok: false,
          accepted: 0,
          rejected: 0,
          rawCount: 0,
          latencyMs: 0,
          retries: 0,
          error: { code: "not-configured", summaryFa: "این منبع پیکربندی نشده است", retryable: false },
          fetchedAt: null,
          fromCache: false,
        },
        offers: [],
        issues: [],
        warnings: [],
      };
    }

    const cacheKey = providerCacheKey({
      providerId: provider.id,
      originAirport: request.originAirports[0] ?? request.originCity,
      destinationAirport: request.destinationAirports[0] ?? request.destinationCity,
      departDate,
      passengers: request.passengers,
      cabin: request.cabin,
    });

    try {
      type CachedResult = Awaited<ReturnType<LiveProviderAdapter<unknown>["search"]>>;
      const cached = this.options.cache.get(cacheKey) as CachedResult | null;

      const result = cached ?? (await provider.search(request, {
        signal,
        logger: this.options.logger,
        now: this.options.now,
        budgetMs: this.options.searchBudgetMs,
      }));

      if (!cached) this.options.cache.set(cacheKey, result, this.options.cacheTtlMs);

      const batch = provider.normalize(result.records, request, result.meta);

      return {
        report: {
          ...base,
          ok: true,
          accepted: batch.offers.length,
          rejected: batch.issues.length,
          rawCount: result.rawCount,
          latencyMs: result.meta.latencyMs,
          retries: result.meta.retries,
          error: null,
          fetchedAt: result.meta.fetchedAt,
          fromCache: Boolean(cached),
          warnings: result.warnings,
        },
        offers: batch.offers,
        issues: batch.issues,
        warnings: result.warnings,
      };
    } catch (error) {
      const providerError = asProviderError(error);
      this.options.logger.warn("provider.failed", {
        provider: provider.id,
        code: providerError.code,
        retryable: providerError.retryable,
        detail: providerError.detail ?? "",
      });

      return {
        report: {
          ...base,
          ok: false,
          accepted: 0,
          rejected: 0,
          rawCount: 0,
          latencyMs: Date.now() - startedAt,
          retries: 0,
          error: {
            code: providerError.code as ProviderErrorCode,
            // The diagnosis (why the page yielded nothing, and the next action) is part of
            // the summary — a report that only says "پاسخ منبع قابل تفسیر نبود" makes the
            // operator re-run the whole thing to learn something we already knew.
            summaryFa: providerError.detail
              ? `${providerError.summaryFa} — ${providerError.detail}`
              : providerError.summaryFa,
            httpStatus: providerError.httpStatus,
            retryable: providerError.retryable,
          },
          fetchedAt: null,
          fromCache: false,
        },
        offers: [],
        issues: [],
        warnings: [],
      };
    }
  }
}

/**
 * Collapse rows that describe the same product within one provider: same fare-level
 * key → keep the cheapest, and record how many rows merged into it (auditability).
 */
export function dedupeSameOffer(offers: FlightOffer[], warnings: string[] = []): FlightOffer[] {
  const byKey = new Map<string, FlightOffer>();

  for (const offer of offers) {
    const key = `${offer.providerId}|${offerKey({
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
    })}`;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, offer);
      continue;
    }

    const existingMerged = existing.provenance?.mergedRows ?? 1;
    const winner = compareCheapest(offer, existing) < 0 ? offer : existing;
    const merged = existingMerged + (offer.provenance?.mergedRows ?? 1);

    const bestSellers = Math.max(existing.provenance?.sellerCount ?? 0, offer.provenance?.sellerCount ?? 0);
    byKey.set(key, {
      ...winner,
      provenance: winner.provenance
        ? { ...winner.provenance, mergedRows: merged, sellerCount: bestSellers > 0 ? bestSellers : null }
        : {
            sourceKind: "demo",
            endpoint: "",
            rawRecordId: null,
            sellerLabel: null,
            unitConverted: false,
            mergedRows: merged,
            sellerCount: null,
          },
    });
    if (merged > 1 && !warnings.includes("duplicate-rows-collapsed")) warnings.push("duplicate-rows-collapsed");
  }

  return [...byKey.values()];
}

function compareCheapest(a: FlightOffer, b: FlightOffer): number {
  if (a.price.toman !== b.price.toman) return a.price.toman - b.price.toman;
  const freshness = new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime();
  if (freshness !== 0) return freshness;
  return a.id.localeCompare(b.id);
}

/**
 * Run thunks with a concurrency cap, preserving result order.
 * Batching (rather than a worker pool) is deliberate: with at most a handful of
 * providers it keeps behaviour trivially predictable and avoids stampeding a source.
 */
export async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = [];
  const limit = Math.max(1, concurrency);
  for (let index = 0; index < tasks.length; index += limit) {
    const batch = tasks.slice(index, index + limit);
    results.push(...(await Promise.all(batch.map((task) => task()))));
  }
  return results;
}

/** Heuristic used only to choose which airport to ask a source about. */
export function isInternational(originCity: string, destinationCity: string): boolean {
  const domestic = new Set([
    "THR",
    "MHD",
    "SYZ",
    "IFN",
    "TBZ",
    "KIH",
    "AWZ",
    "BND",
    "GSM",
    "RAS",
    "KER",
    "ZAH",
    "OMH",
    "AZD",
    "NJF",
  ]);
  return !(domestic.has(originCity) && domestic.has(destinationCity));
}

export { ProviderError };
