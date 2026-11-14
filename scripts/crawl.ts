import { runSource } from "../src/crawler/run";
import { CRAWL_SOURCES, getCrawlSource, isCrawlSourceId } from "../src/crawler/sources";

const args = process.argv.slice(2);
const flag = (key: string) => { const index = args.indexOf(key); return index < 0 ? undefined : args[index + 1]; };
if (process.env.CRAWLER_ENABLED !== "1") throw new Error("Crawler is disabled. Run with CRAWLER_ENABLED=1 to explicitly enable the local job.");
const route = (flag("--route") ?? process.env.CRAWL_ROUTE ?? "").toUpperCase();
const date = flag("--date") ?? process.env.CRAWL_DATE ?? "";
if (!/^[A-Z]{3}-[A-Z]{3}$/.test(route) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  throw new Error("Usage: CRAWLER_ENABLED=1 npm run crawl -- --route THR-MHD --date YYYY-MM-DD [--source safarmarket]");
}
const requestedSource = flag("--source");
if (requestedSource && !isCrawlSourceId(requestedSource)) throw new Error(`Unknown crawl source: ${requestedSource}`);
const sources = requestedSource ? [getCrawlSource(requestedSource)!] : CRAWL_SOURCES;
const [originCode, destinationCode] = route.split("-");
const query = { originCode: originCode!, destinationCode: destinationCode!, departDate: date, passengers: Number(flag("--passengers") ?? 1), cabin: flag("--cabin") ?? "economy" };
if (!Number.isInteger(query.passengers) || query.passengers < 1) throw new Error("--passengers must be a positive integer");

let successful = 0;
for (const source of sources) {
  try {
    const snapshot = await runSource(source, query);
    successful += 1;
    console.log(`${source.id}: stored ${snapshot.offers.length} raw offers in data/crawl/latest.json`);
  } catch (error) {
    console.error(`${source.id}: ${error instanceof Error ? error.message : "unknown crawl error"}`);
  }
}
if (successful === 0) {
  process.exitCode = 1;
  console.error("No crawl snapshot was written. Resolve the source-specific fixture/request blockers first.");
}
