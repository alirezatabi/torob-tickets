import { patternsForRoute } from "@/lib/schedules";
import { diffDays, isoToday } from "@/lib/jalali";
import { seededUnit } from "@/lib/time";
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
  /** Bookable seats this provider claims, 0..9, deterministic (see `demoSeats`). */
  seatsAvailable: number;
}

export interface DemoProviderSpec {
  id: string;
  rules: FareRules;
  /** How the provider's own "updated at" lags behind the fetch (minutes). */
  stalenessMinutes: number;
  /** Artificial latency for realistic loading states in the demo. */
  latencyMs: number;
}

/**
 * Stable pseudo-random in [0,1) from a string.
 *
 * One implementation only (`lib/time.seededUnit`): the copy that used to live here could
 * return exactly 1 for a hash of 0xffffffff, which made `seed < p` coverage tests flaky at
 * the boundary.
 */
const unit = seededUnit;

/**
 * Demo sellers, in the order the dataset guarantees coverage.
 *
 * The product's promise is "several sellers for the *same* flight", so a purely random
 * per-provider draw can — and did — leave a flight with a single seller. Coverage is
 * therefore two-layer:
 *
 *   1. each provider carries a deterministic subset of the timetable (`DEMO_COVERAGE`),
 *   2. any flight with fewer than `minSellers()` sellers is topped up from providers at the
 *      front of this list, so the promise holds for every flight, on every day.
 *
 * Still fully deterministic: the same flight on the same date always gets the same sellers.
 */
export const DEMO_SELLER_PRIORITY = ["pars", "alibaba", "flightio", "mahan"] as const;

/** How much of the timetable each seller carries (before the guarantee is applied). */
export const DEMO_COVERAGE: Record<string, number> = {
  pars: 0.82,
  alibaba: 0.75,
  flightio: 0.66,
  mahan: 0.85,
};

/** `DEMO_GUARANTEE_SELLERS` (default 3) — how many sellers every flight has. */
export function minSellers(): number {
  const raw = Number.parseInt(process.env.DEMO_GUARANTEE_SELLERS ?? "", 10);
  if (Number.isFinite(raw) && raw >= 1 && raw <= DEMO_SELLER_PRIORITY.length) return raw;
  return 3;
}

/** Deterministic: does `providerId` carry this flight pattern at all? */
function baseCoverage(providerId: string, patternId: string): boolean {
  const threshold = DEMO_COVERAGE[providerId] ?? 0.5;
  return unit(`${providerId}:${patternId}`) < threshold;
}

/** True when this provider must carry the pattern so the seller floor is met. */
export function guaranteedCoverage(providerId: string, patternId: string): boolean {
  const carriers: string[] = DEMO_SELLER_PRIORITY.filter((id) => baseCoverage(id, patternId));
  if (carriers.includes(providerId)) return true;
  const missing = Math.max(0, minSellers() - carriers.length);
  if (missing === 0) return false;

  // Which sellers fill the gap is *also* deterministic, but varies per flight, so the top-up
  // does not always favour the same provider (that would make one source look universal).
  const fill: string[] = DEMO_SELLER_PRIORITY.filter((id) => !carriers.includes(id))
    .map((id) => ({ id, order: unit(`fill:${patternId}:${id}`) }))
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
    .slice(0, missing)
    .map((entry) => entry.id);
  return fill.includes(providerId);
}

/**
 * Seats this seller has left for one flight.
 *
 * Deterministic per `(provider, flight, date)` and in **0..9** — the range where capacity
 * actually changes a decision (a plane with 9 left is a warning, not a full seat map).
 * 0 is included on purpose: it exercises the «ظرفیت کافی نیست» path.
 */
export function demoSeats(providerId: string, patternId: string, dateIso: string): number {
  return Math.floor(unit(`seats:${providerId}:${patternId}:${dateIso}`) * 10);
}

export function collectTickets(
  spec: DemoProviderSpec,
  query: TripQuery,
  now: Date,
): DemoTicket[] {
  const patterns = patternsForRoute(query.originCode, query.destinationCode, query.departDate);
  const daysAhead = Math.max(0, diffDays(isoToday(now), query.departDate));
  const fetchedAt = now.toISOString();

  return patterns
    .filter((pattern) => guaranteedCoverage(spec.id, pattern.id))
    .map((pattern) => ({
      quote: quoteFare(spec.id, pattern, query.departDate, daysAhead, spec.rules),
      fetchedAt,
      seatsAvailable: demoSeats(spec.id, pattern.id, query.departDate),
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
 * The whole product follows that rule now: no offer in this build has an external page.
 */
export function demoOfferUrl(_providerId: string, _patternId: string, dateIso: string): string {
  return `/search?date=${dateIso}`;
}
