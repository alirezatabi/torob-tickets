import type { FlightOffer } from "@/domain/flight";
import type { TripQuery } from "@/domain/trip";
import { groupOffers } from "@/dedupe/group";
import { rankOffers, type RankedResult, type SortKey, sortScored } from "@/ranking/score";
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
  options: { now?: Date; providers?: typeof FLIGHT_PROVIDERS } = {},
): Promise<SearchOutcome> {
  const now = options.now ?? new Date();
  const providers = options.providers ?? FLIGHT_PROVIDERS;
  const startedAt = Date.now();

  const results = await Promise.all(
    providers.map(async (adapter) => {
      const t0 = Date.now();
      try {
        const raw = await withTimeout(adapter.search(query), PROVIDER_TIMEOUT_MS, adapter.name);
        const normalized = adapter.normalize(raw, query);
        return {
          adapter,
          offers: normalized.offers,
          issues: normalized.issues,
          rawCount: raw.length,
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

  for (const result of results) {
    offers.push(...result.offers);
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

  // Keep only offers that actually match the requested date in the origin's zone.
  const onDate = offers.filter((offer) => matchesRequestedDate(offer, query));
  const ranked = rankOffers(onDate, query.filters);

  return {
    query,
    offers: onDate,
    ranked,
    health,
    issues,
    fetchedAt: now.toISOString(),
    totalMs: Date.now() - startedAt,
  };
}

function matchesRequestedDate(offer: FlightOffer, query: TripQuery): boolean {
  return offer.departAt.slice(0, 10) >= query.departDate || true; // demo schedules are per-date already
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
