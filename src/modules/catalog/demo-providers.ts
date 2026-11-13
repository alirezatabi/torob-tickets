/**
 * The demo provider catalog.
 *
 * This app ships with **one** kind of data: the generated demo dataset. There is no
 * connector to an outside source any more — no HTTP, no scraping, no API key, no mode
 * switch. Everything a search returns is produced in-process from
 * `src/lib/schedules.ts` and `src/providers/registry.ts`, and every surface labels it as
 * sample data.
 *
 * What remains of the old "live" plumbing is exactly two *reporting* concepts, kept
 * because the UI and the database use them to say honestly what happened:
 *   • `SearchMode` — always `"demo"` now; kept as an explicit type so a caller cannot
 *     accidentally claim otherwise;
 *   • `ProviderRunReport` — one row per demo provider per search (how many offers it
 *     produced, how long it took), which the `/live` page and the persistence layer show.
 */

import { FLIGHT_PROVIDERS } from "@/providers/registry";

/** The only data source this build has. */
export type SearchMode = "demo";

export const SEARCH_MODE: SearchMode = "demo";

export interface ProviderRunReport {
  providerId: string;
  providerName: string;
  mode: "demo";
  ok: boolean;
  /** Offers that survived normalization. */
  accepted: number;
  /** Rows rejected by normalization. */
  rejected: number;
  /** Raw rows returned by the generator. */
  rawCount: number;
  latencyMs: number;
  retries: number;
  error: { code: string; summaryFa: string } | null;
  fetchedAt: string | null;
  fromCache: boolean;
  /** Non-fatal notes worth putting on the record. */
  warnings?: string[];
}

export interface DemoProviderSummary {
  id: string;
  name: string;
  description: string;
  quotedCurrency: string;
  /** Every demo provider is "configured" by definition: it is generated locally. */
  configured: true;
  sourceKind: "demo";
  /** Sample data can never claim a real seat count for a real flight. */
  canClaimAvailability: false;
  missingFactsFa: string[];
}

const MISSING_FACTS_FA = ["قیمت لحظه‌ای واقعی", "موجودی واقعی صندلی", "لینک خرید در منبع"];

/** The providers the demo dataset claims to be comparing (they are in-process sellers). */
export function describeDemoProviders(): DemoProviderSummary[] {
  return FLIGHT_PROVIDERS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    description: provider.description,
    quotedCurrency: provider.quotedCurrency,
    configured: true as const,
    sourceKind: "demo" as const,
    canClaimAvailability: false as const,
    missingFactsFa: MISSING_FACTS_FA,
  }));
}
