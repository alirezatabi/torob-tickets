import { createQuery, DEFAULT_PREFERENCES } from "@/domain/trip";
import { recordCrawlPriceHistory, assertCrawlHistoryDatabase } from "@/modules/persistence/crawl-history";
import { safarmarketSnapshotAdapter } from "@/providers/crawled/safarmarket";
import { runSource } from "./run";
import { CrawlHttpClient } from "./http";
import { safarmarketSource } from "./sources/safarmarket";
import { writeCrawlWorkerStatus } from "./worker-status";
import type { CrawlQuery } from "./types";

const MAX_QUERIES_PER_CYCLE = 39; // one robots.txt request + at most 39 POST queries within the client's 40-request ceiling

export interface WorkerConfig {
  routes: Array<{ originCode: string; destinationCode: string }>;
  intervalMs: number;
  horizonDays: number;
  requestDelayMs: number;
}

export function loadWorkerConfig(env: { CRAWLER_ROUTES?: string; CRAWLER_INTERVAL_MINUTES?: string; CRAWLER_HORIZON_DAYS?: string; CRAWLER_REQUEST_DELAY_MS?: string } = {
  CRAWLER_ROUTES: process.env.CRAWLER_ROUTES,
  CRAWLER_INTERVAL_MINUTES: process.env.CRAWLER_INTERVAL_MINUTES,
  CRAWLER_HORIZON_DAYS: process.env.CRAWLER_HORIZON_DAYS,
  CRAWLER_REQUEST_DELAY_MS: process.env.CRAWLER_REQUEST_DELAY_MS,
}): WorkerConfig {
  const value = env.CRAWLER_ROUTES?.trim();
  if (!value) throw new Error("Set CRAWLER_ROUTES explicitly to real domestic airport pairs (e.g. THR-MHD,THR-SYZ); demo timetable routes are not used.");
  const routes = value.split(",").map((entry) => {
    const match = /^\s*([A-Z]{3})\s*-\s*([A-Z]{3})\s*$/.exec(entry.toUpperCase());
    if (!match || match[1] === match[2]) throw new Error(`Invalid domestic airport pair: ${entry}`);
    return { originCode: match[1]!, destinationCode: match[2]! };
  });
  const unique = [...new Map(routes.map((route) => [`${route.originCode}-${route.destinationCode}`, route])).values()];
  const intervalMs = parseBoundedInteger(env.CRAWLER_INTERVAL_MINUTES, 60, 60, 24 * 60) * 60_000;
  const horizonDays = parseBoundedInteger(env.CRAWLER_HORIZON_DAYS, 1, 1, 14);
  const requestDelayMs = parseBoundedInteger(env.CRAWLER_REQUEST_DELAY_MS, 10_000, 3_000, 60_000);
  if (unique.length * horizonDays > MAX_QUERIES_PER_CYCLE) throw new Error(`At most ${MAX_QUERIES_PER_CYCLE} route/date queries fit the crawler's per-cycle HTTP request ceiling`);
  return { routes: unique, intervalMs, horizonDays, requestDelayMs };
}

/** One bounded sweep. Meant to be run by a dedicated persistent worker, never a page handler. */
export async function runWorkerCycle(config = loadWorkerConfig(), now = new Date()): Promise<{ routesAttempted: number; snapshotsWritten: number; observationsWritten: number }> {
  await assertCrawlHistoryDatabase();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  let snapshotsWritten = 0;
  let observationsWritten = 0;
  const client = new CrawlHttpClient({ minHostDelayMs: config.requestDelayMs });
  for (const route of config.routes) {
    for (let offset = 0; offset < config.horizonDays; offset += 1) {
      const departDate = addDays(date, offset);
      const query: CrawlQuery = { ...route, departDate, passengers: 1, cabin: "economy" };
      const snapshot = await runSource(safarmarketSource, query, { enabled: true, client });
      snapshotsWritten += 1;
      for (const cabin of ["economy", "business"] as const) {
        const tripQuery = createQuery({
          originCode: route.originCode,
          destinationCode: route.destinationCode,
          departDate,
          cabin,
          filters: { ...DEFAULT_PREFERENCES, dataSource: "real" },
        });
        const normalized = safarmarketSnapshotAdapter.normalize(snapshot.offers.map((raw) => ({ raw, fetchedAt: snapshot.fetchedAt })), tripQuery);
        observationsWritten += await recordCrawlPriceHistory(normalized.offers, { observedAt: new Date(snapshot.fetchedAt) });
      }
    }
  }
  return { routesAttempted: config.routes.length * config.horizonDays, snapshotsWritten, observationsWritten };
}

/** Daemon loop: strict opt-in, no overlap, bounded error handling, status heartbeat. */
export async function startCrawlWorker(): Promise<void> {
  if (process.env.CRAWLER_ENABLED !== "1") throw new Error("Set CRAWLER_ENABLED=1 to explicitly enable the continuous crawler");
  const config = loadWorkerConfig();
  await assertCrawlHistoryDatabase();
  let stopping = false;
  let wakeSleep: (() => void) | null = null;
  const stop = () => { stopping = true; wakeSleep?.(); };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  while (!stopping) {
    await writeCrawlWorkerStatus({ state: "running", heartbeatAt: new Date().toISOString() });
    try {
      const result = await runWorkerCycle(config);
      await writeCrawlWorkerStatus({ state: "running", heartbeatAt: new Date().toISOString(), lastCycleAt: new Date().toISOString(), lastCycle: result });
      console.info("Crawl cycle completed", result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeCrawlWorkerStatus({ state: "error", heartbeatAt: new Date().toISOString(), lastError: message.slice(0, 500) });
      console.error("Crawl cycle failed", message);
    }
    if (!stopping) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, config.intervalMs);
        wakeSleep = () => { clearTimeout(timer); resolve(); };
      });
      wakeSleep = null;
    }
  }
  await writeCrawlWorkerStatus({ state: "stopped", heartbeatAt: new Date().toISOString() });
  process.exitCode = 0;
}

function parseBoundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`Expected integer between ${min} and ${max}, received ${value}`);
  return parsed;
}

function addDays(isoDate: string, offset: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
