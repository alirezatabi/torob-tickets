/**
 * Live provider registry.
 *
 * Two rules:
 *   • a provider is only listed when it is *configured* (Sepehr360 needs nothing,
 *     Amadeus needs keys) — but a listed provider may still fail at request time, and
 *     that failure is reported, never hidden;
 *   • the mode comes from the environment, so the UI can state which mode it is in
 *     without guessing (`live` only when at least one live provider is enabled).
 */

import { SearchOrchestrator, type OrchestratorOptions } from "@/modules/providers/orchestrator";
import { AmadeusAdapter, amadeusConfigFromEnv } from "@/modules/providers/amadeus/adapter";
import { Sepehr360Adapter, sepehr360ConfigFromEnv } from "@/modules/providers/sepehr360/adapter";
import type { LiveProviderAdapter } from "@/modules/providers/contracts/provider";
import { createLogger } from "@/modules/providers/shared/logger";

export type SearchMode = "demo" | "live";

export interface LiveProviderSummary {
  id: string;
  name: string;
  configured: boolean;
  sourceKind: "html" | "api";
  description: string;
  complianceNoteFa: string;
  freshnessNoteFa: string;
  /** False when the source cannot state availability at all. */
  canClaimAvailability: boolean;
  /** What the source cannot tell us — printed in the UI so the gap is visible. */
  missingFactsFa: string[];
}

/** Which mode the app should run in. */
export function searchMode(env: Record<string, string | undefined> = process.env): SearchMode {
  return env.TOROB_SEARCH_MODE === "live" ? "live" : "demo";
}

export function buildLiveProviders(env: Record<string, string | undefined> = process.env): LiveProviderAdapter<never>[] {
  const providers: LiveProviderAdapter<never>[] = [];

  const sepehr = new Sepehr360Adapter(sepehr360ConfigFromEnv(env));
  if (sepehr.isConfigured()) providers.push(sepehr as unknown as LiveProviderAdapter<never>);

  const amadeus = new AmadeusAdapter(amadeusConfigFromEnv(env));
  if (amadeus.isConfigured()) providers.push(amadeus as unknown as LiveProviderAdapter<never>);

  return providers;
}

export function describeLiveProviders(env: Record<string, string | undefined> = process.env): LiveProviderSummary[] {
  const sepehr = new Sepehr360Adapter(sepehr360ConfigFromEnv(env));
  const amadeus = new AmadeusAdapter(amadeusConfigFromEnv(env));

  return [
    {
      id: sepehr.id,
      name: sepehr.name,
      configured: sepehr.isConfigured(),
      sourceKind: "html",
      description: sepehr.description,
      complianceNoteFa: sepehr.complianceNoteFa,
      freshnessNoteFa: sepehr.freshness.noteFa,
      canClaimAvailability: sepehr.freshness.canClaimAvailability,
      missingFactsFa: ["شماره پرواز", "بار مجاز", "شرایط استرداد", "موجودی صندلی", "لینک اختصاصی هر نرخ"],
    },
    {
      id: amadeus.id,
      name: amadeus.name,
      configured: amadeus.isConfigured(),
      sourceKind: "api",
      description: amadeus.description,
      complianceNoteFa: amadeus.complianceNoteFa,
      freshnessNoteFa: amadeus.freshness.noteFa,
      canClaimAvailability: amadeus.freshness.canClaimAvailability,
      missingFactsFa: ["قیمت تومانی (فقط ارز خارجی)", "شرایط استرداد", "لینک عمومی نرخ"],
    },
  ];
}

/** Build an orchestrator for the current environment. */
export function createOrchestrator(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<OrchestratorOptions> = {},
): SearchOrchestrator {
  return new SearchOrchestrator({
    providers: buildLiveProviders(env) as OrchestratorOptions["providers"],
    logger: createLogger("search"),
    ...overrides,
  });
}
