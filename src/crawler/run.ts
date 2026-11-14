import { CrawlHttpClient } from "./http";
import { normalizeRawOffers } from "./normalize";
import { writeSnapshot } from "./store";
import type { CrawlQuery, CrawlSource, CrawlSnapshot } from "./types";

export interface CrawlRunOptions { client?: CrawlHttpClient; enabled?: boolean; saveSnapshot?: typeof writeSnapshot }
export async function runSource(source: CrawlSource, query: CrawlQuery, options: CrawlRunOptions = {}): Promise<CrawlSnapshot> {
  const enabled = options.enabled ?? process.env.CRAWLER_ENABLED === "1";
  if (!enabled) throw new Error("Crawler is disabled. Set CRAWLER_ENABLED=1 for an explicit local job.");
  const requests = source.buildRequests(query);
  if (requests.length === 0) throw new Error(`${source.id}: buildRequests returned no requests`);
  const client = options.client ?? new CrawlHttpClient();
  const raw = [];
  for (const request of requests) {
    if (request.blockedReason) throw new Error(`${source.id}: ${request.blockedReason}`);
    if (request.method === "POST" && request.body === null) throw new Error(`${source.id}: POST body is missing`);
    const response = request.method === "GET"
      ? await client.get(request.url)
      : await client.postJson(request.url, request.body!);
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
  await (options.saveSnapshot ?? writeSnapshot)(snapshot);
  return snapshot;
}
