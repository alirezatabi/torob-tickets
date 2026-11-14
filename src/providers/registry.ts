import type { ProviderAdapter } from "./types";
import { parsAdapter, type ParsRawOffer } from "./flight/pars";
import { alibabaAdapter, flightioAdapter, mahanAdapter } from "./flight/adapters";
import { safarmarketSnapshotAdapter } from "./crawled/safarmarket";
import { CRAWL_SOURCES, CRAWLER_PARSER_STATUS } from "@/crawler/sources";
import type { CrawlSourceId } from "@/crawler/types";

/**
 * The provider registry. Adding a provider = writing an adapter + one line here.
 * A future `train` registry would follow the same shape with a different mode.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const FLIGHT_PROVIDERS: ProviderAdapter<any>[] = [
  parsAdapter as ProviderAdapter<ParsRawOffer>,
  alibabaAdapter,
  flightioAdapter,
  mahanAdapter,
  safarmarketSnapshotAdapter,
];

/** Crawl candidates stay out of the network registry; Safarmarket search reads only a local snapshot. */
export const CRAWLED_PROVIDER_REGISTRY: { id: CrawlSourceId; name: string; mode: "crawled"; enabled: boolean; status: string }[] = CRAWL_SOURCES.map((source) => ({
  id: source.id,
  name: source.name,
  mode: "crawled",
  enabled: source.id === "safarmarket",
  status: CRAWLER_PARSER_STATUS[source.id],
}));

export function listProviders(): { id: string; name: string; mode: "demo" | "live" | "crawled"; description: string; quotedCurrency: string }[] {
  return FLIGHT_PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    mode: p.mode,
    description: p.description,
    quotedCurrency: p.quotedCurrency,
  }));
}
