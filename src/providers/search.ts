import type { FlightOffer } from "@/domain/flight";
import type { TripQuery } from "@/domain/trip";
import { groupOffers } from "@/dedupe/group";
import { isWithinSalesWindow, rankOffers, tripMatchesOfferDate, type RankedResult, type SortKey, sortScored } from "@/ranking/score";
import { FLIGHT_PROVIDERS } from "./registry";
import type { NormalizationIssue, ProviderHealth } from "./types";

/**
 * The aggregation pipeline. Pure orchestration — it knows nothing about the
 * providers' wire formats, only the adapter contract:
 *
 *   search (parallel, per-provider timeout)
 *     → normalize (per adapter)
 *     → dedupe/group (cross-provider identity)
 *     → rank (deterministic scoring)
 *
 * A provider that throws or times out is reported as unhealthy instead of
 * breaking the whole search.
 */

export interface SearchOutcome {
  query: TripQuery;
  offers: FlightOffer[];
  ranked: RankedResult;
  health: ProviderHealth[];
  /** How many raw rows each included provider produced, before normalization and before the
   *  requested-day / on-sale filters — the audit trail the `/live` page shows. */
  rawCounts: Record<string, number>;
  issues: NormalizationIssue[];
  /** Wall-clock of the aggregation run (ISO). */
  fetchedAt: string;
  /** Total provider latency incl. normalization. */
  totalMs: number;
}

const PROVIDER_TIMEOUT_MS = 2_500;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runSearch(
  query: TripQuery,
  options: { now?: Date; providers?: typeof FLIGHT_PROVIDERS; includeCrawled?: boolean } = {},
): Promise<SearchOutcome> {
  const now = options.now ?? new Date();
  // The shipped site is real-data-only. Demo adapters remain usable by isolated unit tests,
  // but every non-test search is forced to the real-source filter regardless of URL params.
  const effectiveQuery: TripQuery = process.env.NODE_ENV === "test"
    ? query
    : { ...query, filters: { ...query.filters, dataSource: "real" } };
  const allowCrawled = options.includeCrawled ?? process.env.NODE_ENV !== "test";
  const allProviders = (options.providers ?? FLIGHT_PROVIDERS).filter((provider) => provider.mode !== "crawled" || allowCrawled);
  const providers = allProviders.filter((provider) => {
    if (effectiveQuery.filters.dataSource === "demo") return provider.mode === "demo";
    if (effectiveQuery.filters.dataSource === "real") return provider.mode !== "demo";
    return true;
  });
  const startedAt = Date.now();

  const results = await Promise.all(
    providers.map(async (adapter) => {
      const t0 = Date.now();
      try {
        const records = await withTimeout(adapter.search(effectiveQuery, { now }), PROVIDER_TIMEOUT_MS, adapter.name);
        const normalized = adapter.normalize(records, effectiveQuery);
        return {
          adapter,
          offers: normalized.offers,
          issues: normalized.issues,
          rawCount: records.length,
          latencyMs: Date.now() - t0,
          error: undefined as string | undefined,
        };
      } catch (error) {
        return {
          adapter,
          offers: [] as FlightOffer[],
          issues: [] as NormalizationIssue[],
          rawCount: 0,
          latencyMs: Date.now() - t0,
          error: error instanceof Error ? error.message : "Unknown provider error",
        };
      }
    }),
  );

  const offers: FlightOffer[] = [];
  const health: ProviderHealth[] = [];
  const issues: NormalizationIssue[] = [];
  const rawCounts: Record<string, number> = {};

  for (const result of results) {
    // No matching local snapshot is a normal empty state; never fill it with sample offers.
    if (result.adapter.mode === "crawled" && result.rawCount === 0 && result.error === undefined) continue;
    offers.push(...result.offers);
    rawCounts[result.adapter.id] = result.rawCount;
    issues.push(...result.issues);
    health.push({
      id: result.adapter.id,
      name: result.adapter.name,
      mode: result.adapter.mode,
      description: result.adapter.description,
      quotedCurrency: result.adapter.quotedCurrency,
      ok: result.error === undefined,
      returned: result.offers.length,
      rejected: result.issues.length,
      latencyMs: result.latencyMs,
      ...(result.error ? { error: result.error } : {}),
    });
  }

  // Keep only offers that really depart on the requested **local** day, and — when that day
  // is today — only those still on sale (a 14:00 departure cannot be sold at 16:00).
  const onDate = offers.filter(
    (offer) => tripMatchesOfferDate(effectiveQuery, offer) && isWithinSalesWindow(offer, now),
  );
  const ranked = rankOffers(onDate, effectiveQuery.filters);

  return {
    query: effectiveQuery,
    offers: onDate,
    ranked,
    health,
    rawCounts,
    issues,
    fetchedAt: now.toISOString(),
    totalMs: Date.now() - startedAt,
  };
}

/** Grouped + sorted offers, the shape the results page consumes. */
export function prepareResultList(outcome: SearchOutcome, sort: SortKey) {
  const scored = sortScored(outcome.ranked.ranked, sort);
  const groups = groupOffers(scored.map((s) => s.offer));
  const byKey = new Map(groups.map((g) => [g.groupKey, g]));
  const rows = scored
    .map((scoredOffer) => {
      const group = byKey.get(scoredOffer.offer.groupKey);
      return group ? { scored: scoredOffer, group } : null;
    })
    .filter((row): row is { scored: (typeof scored)[number]; group: (typeof groups)[number] } => row !== null);

  // One card per physical flight; keep the first (best-ranked) occurrence.
  const seen = new Set<string>();
  const unique = rows.filter((row) => {
    if (seen.has(row.group.groupKey)) return false;
    seen.add(row.group.groupKey);
    return true;
  });

  return { groups, rows: unique };
}
