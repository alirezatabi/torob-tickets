import { CrawlHttpClient } from "./http";
import { normalizeRawOffers } from "./normalize";
import { writeSnapshot } from "./store";
import type { CrawlQuery, CrawlSource, CrawlSnapshot } from "./types";

export interface CrawlRunOptions { client?: CrawlHttpClient; enabled?: boolean }
export async function runSource(source: CrawlSource, query: CrawlQuery, options: CrawlRunOptions = {}): Promise<CrawlSnapshot> {
  const enabled = options.enabled ?? process.env.CRAWLER_ENABLED === "1";
  if (!enabled) throw new Error("Crawler is disabled. Set CRAWLER_ENABLED=1 for an explicit local job.");
  const requests = source.buildRequests(query);
  if (requests.length === 0) throw new Error(`${source.id}: buildRequests returned no requests`);
  const client = options.client ?? new CrawlHttpClient();
  const raw = [];
  for (const request of requests) {
    if (request.blockedReason) throw new Error(`${source.id}: ${request.blockedReason}`);
    // The HTTP client intentionally supports only GET until a source has a captured,
    // verified request body and method-specific safety tests. Do not send guessed POSTs.
    if (request.method !== "GET") throw new Error(`${source.id}: ${request.method} request execution is not enabled without verified request details`);
    const response = await client.get(request.url);
    raw.push(...source.parseRaw(await response.text(), {
      route: `${query.originCode}-${query.destinationCode}`,
      date: query.departDate,
      url: request.url,
    }));
  }
  const offers = normalizeRawOffers(raw);
  const snapshot: CrawlSnapshot = {
    schemaVersion: 1,
    source: source.id,
    fetchedAt: new Date().toISOString(),
    route: `${query.originCode}-${query.destinationCode}`,
    date: query.departDate,
    offers,
  };
  await writeSnapshot(snapshot);
  return snapshot;
}
