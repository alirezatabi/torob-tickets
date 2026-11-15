import type { ProviderAdapter } from "./types";
import { parsAdapter, type ParsRawOffer } from "./flight/pars";
import { alibabaAdapter, flightioAdapter, mahanAdapter } from "./flight/adapters";
import { safarmarketSnapshotAdapter } from "./crawled/safarmarket";
import { CRAWL_SOURCES, CRAWLER_PARSER_STATUS } from "@/crawler/sources";
import type { CrawlSourceId } from "@/crawler/types";

// Adapters remain available to isolated tests, but runSearch is locked to real sources
// outside NODE_ENV=test. They are never exposed by listProviders or used to serve the site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const FLIGHT_PROVIDERS: ProviderAdapter<any>[] = [
  parsAdapter as ProviderAdapter<ParsRawOffer>,
  alibabaAdapter,
  flightioAdapter,
  mahanAdapter,
  safarmarketSnapshotAdapter,
];

/** Only the source actually used by the site is advertised. */
export const CRAWLED_PROVIDER_REGISTRY: { id: CrawlSourceId; name: string; mode: "crawled"; enabled: boolean; status: string }[] = CRAWL_SOURCES.map((source) => ({
  id: source.id,
  name: source.name,
  mode: "crawled",
  enabled: source.id === "safarmarket",
  status: CRAWLER_PARSER_STATUS[source.id],
}));

export function listProviders(): { id: string; name: string; mode: "demo" | "live" | "crawled"; description: string; quotedCurrency: string }[] {
  return FLIGHT_PROVIDERS.filter((provider) => provider.mode !== "demo").map((provider) => ({
    id: provider.id,
    name: provider.name,
    mode: provider.mode,
    description: provider.description,
    quotedCurrency: provider.quotedCurrency,
  }));
}
