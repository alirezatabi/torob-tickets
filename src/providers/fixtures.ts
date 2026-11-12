import { patternsForRoute } from "@/lib/schedules";
import { diffDays } from "@/lib/jalali";
import type { TripQuery } from "@/domain/trip";
import { quoteFare, type FareRules, type FareQuote } from "./fare";

/**
 * Demo provider plumbing shared by all simulated adapters.
 *
 * Each adapter gets its own subset of the timetable (no provider sells every
 * flight, which is what makes aggregation meaningful) and its own fare rules.
 */
export interface DemoTicket {
  quote: FareQuote;
  fetchedAt: string;
}

export interface DemoProviderSpec {
  id: string;
  /** Fraction of available patterns this provider carries. */
  coverage: (seed: number) => boolean;
  rules: FareRules;
  /** How the provider's own "updated at" lags behind the fetch (minutes). */
  stalenessMinutes: number;
  /** Artificial latency for realistic loading states in the demo. */
  latencyMs: number;
}

/** Stable pseudo-random in [0,1) from a string. */
function unit(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash / 0xffffffff;
}

export function collectTickets(
  spec: DemoProviderSpec,
  query: TripQuery,
  now: Date,
): DemoTicket[] {
  const patterns = patternsForRoute(query.originCode, query.destinationCode, query.departDate);
  const daysAhead = Math.max(0, diffDays(now.toISOString().slice(0, 10), query.departDate));
  const fetchedAt = now.toISOString();

  return patterns
    .filter((pattern) => spec.coverage(unit(`${spec.id}:${pattern.id}`)))
    .map((pattern) => ({
      quote: quoteFare(spec.id, pattern, query.departDate, daysAhead, spec.rules),
      fetchedAt,
    }));
}

/** Provider-reported "last updated" instant, always in the past. */
export function providerUpdatedAt(fetchedAt: string, stalenessMinutes: number): string {
  return new Date(new Date(fetchedAt).getTime() - stalenessMinutes * 60_000).toISOString();
}

/**
 * Deterministic in-app link for a demo offer.
 *
 * This used to be `https://example.com/<provider>/flight/…&ref=demo`, which the UI rendered
 * as a live "source" button: a clickable link to a placeholder domain. Demo data has no
 * external page, so the honest link is back into our own comparison for the same route and
 * date — never an absolute URL that implies a real provider page.
 *
 * `modules/live/source-link.ts` enforces the same rule at render time, for every surface.
 */
export function demoOfferUrl(_providerId: string, _patternId: string, dateIso: string): string {
  return `/search?date=${dateIso}`;
}
