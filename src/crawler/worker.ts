import { createQuery, DEFAULT_PREFERENCES } from "@/domain/trip";
import { recordCrawlPriceHistory, assertCrawlHistoryDatabase } from "@/modules/persistence/crawl-history";
import { safarmarketSnapshotAdapter } from "@/providers/crawled/safarmarket";
import { runSource } from "./run";
import { CrawlError, CrawlHttpClient } from "./http";
import { safarmarketSource } from "./sources/safarmarket";
import { basisflySource } from "./sources/basisfly";
import { writeCrawlWorkerStatus } from "./worker-status";
import { crawlWorkerLogger } from "./worker-logger";
import { randomUUID } from "node:crypto";
import type { CrawlQuery } from "./types";

const MAX_HTTP_REQUESTS_PER_CYCLE = 40; // shared client's hard ceiling, including robots.txt per source host

export type WorkerSourceId = "safarmarket" | "basisfly";
export interface WorkerConfig {
  routes: Array<{ originCode: string; destinationCode: string }>;
  sources: WorkerSourceId[];
  intervalMs: number;
  horizonDays: number;
  requestDelayMs: number;
}

export function loadWorkerConfig(env: { CRAWLER_ROUTES?: string; CRAWLER_SOURCES?: string; CRAWLER_INTERVAL_MINUTES?: string; CRAWLER_HORIZON_DAYS?: string; CRAWLER_REQUEST_DELAY_MS?: string } = {
  CRAWLER_ROUTES: process.env.CRAWLER_ROUTES,
  CRAWLER_SOURCES: process.env.CRAWLER_SOURCES,
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
  const requestedSources = (env.CRAWLER_SOURCES?.trim() || "safarmarket").split(",").map((source) => source.trim().toLowerCase());
  if (requestedSources.some((source) => source !== "safarmarket" && source !== "basisfly")) throw new Error("CRAWLER_SOURCES accepts only safarmarket and basisfly");
  const sources = [...new Set(requestedSources)] as WorkerSourceId[];
  if (sources.length === 0) throw new Error("CRAWLER_SOURCES must include safarmarket, basisfly, or both");
  const intervalMs = parseBoundedInteger(env.CRAWLER_INTERVAL_MINUTES, 60, 60, 24 * 60) * 60_000;
  const horizonDays = parseBoundedInteger(env.CRAWLER_HORIZON_DAYS, 1, 1, 14);
  const requestDelayMs = parseBoundedInteger(env.CRAWLER_REQUEST_DELAY_MS, 10_000, 3_000, 60_000);
  const queryCount = unique.length * horizonDays * sources.length;
  const maximumQueries = MAX_HTTP_REQUESTS_PER_CYCLE - sources.length;
  if (queryCount > maximumQueries) throw new Error(`At most ${maximumQueries} total source/route/date queries fit the crawler's per-cycle HTTP request ceiling for ${sources.length} source(s)`);
  return { routes: unique, sources, intervalMs, horizonDays, requestDelayMs };
}

/** One bounded sweep. Meant to be run by a dedicated persistent worker, never a page handler. */
export async function runWorkerCycle(config = loadWorkerConfig(), now = new Date()): Promise<{ routesAttempted: number; snapshotsWritten: number; observationsWritten: number; failures: number; lastError?: string }> {
  const cycleId = randomUUID();
  const startedAt = Date.now();
  await crawlWorkerLogger.log({ level: "info", event: "cycle.started", cycleId, details: { sources: config.sources, routes: config.routes.length, horizonDays: config.horizonDays } });
  try {
    await assertCrawlHistoryDatabase();
  } catch (error) {
    const message = errorMessage(error);
    await crawlWorkerLogger.log({ level: "error", event: "cycle.database_unavailable", cycleId, message });
    throw error;
  }
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  let routesAttempted = 0;
  let snapshotsWritten = 0;
  let observationsWritten = 0;
  let failures = 0;
  let lastError: string | undefined;
  const client = new CrawlHttpClient({ minHostDelayMs: config.requestDelayMs });
  const sources = config.sources.map((id) => id === "safarmarket" ? safarmarketSource : basisflySource);
  const haltedSources = new Set<string>();
  for (const route of config.routes) {
    for (let offset = 0; offset < config.horizonDays; offset += 1) {
      const departDate = addDays(date, offset);
      const query: CrawlQuery = { ...route, departDate, passengers: 1, cabin: "economy" };
      for (const source of sources) {
        if (haltedSources.has(source.id)) continue;
        routesAttempted += 1;
        const queryStartedAt = Date.now();
        await crawlWorkerLogger.log({ level: "info", event: "query.started", cycleId, source: source.id, route: `${route.originCode}-${route.destinationCode}`, date: departDate });
        let snapshot;
        try {
          snapshot = await runSource(source, query, { enabled: true, client });
          snapshotsWritten += 1;
          await crawlWorkerLogger.log({
            level: "info", event: "query.snapshot_written", cycleId, source: source.id,
            route: snapshot.route, date: snapshot.date, durationMs: Date.now() - queryStartedAt,
            details: { offerCount: snapshot.offers.length },
          });
        } catch (error) {
          failures += 1;
          lastError = errorMessage(error);
          await crawlWorkerLogger.log({ level: "error", event: "query.failed", cycleId, source: source.id, route: `${route.originCode}-${route.destinationCode}`, date: departDate, durationMs: Date.now() - queryStartedAt, message: lastError });
          if (error instanceof CrawlError && ["ROBOTS_UNAVAILABLE", "ROBOTS_DISALLOWED", "CHALLENGE_DETECTED"].includes(error.code)) {
            haltedSources.add(source.id);
            await crawlWorkerLogger.log({ level: "warn", event: "source.halted_for_cycle", cycleId, source: source.id, message: error.code });
          }
          continue;
        }
        // Only the Safarmarket snapshot adapter currently has verified semantics for
        // durable seller-level price history. Basisfly snapshots are stored but not
        // written to price history until its adapter is validated against a real fixture.
        if (source.id !== "safarmarket") continue;
        try {
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
        } catch (error) {
          failures += 1;
          lastError = errorMessage(error);
          await crawlWorkerLogger.log({ level: "error", event: "history.write_failed", cycleId, source: source.id, route: snapshot.route, date: snapshot.date, message: lastError });
        }
      }
    }
  }
  const result = { routesAttempted, snapshotsWritten, observationsWritten, failures, ...(lastError ? { lastError } : {}) };
  await crawlWorkerLogger.log({
    level: failures ? "warn" : "info", event: "cycle.finished", cycleId, durationMs: Date.now() - startedAt,
    details: result,
  });
  return result;
}

/** Daemon loop: strict opt-in, no overlap, bounded error handling, status heartbeat. */
export async function startCrawlWorker(): Promise<void> {
  if (process.env.CRAWLER_ENABLED !== "1") throw new Error("Set CRAWLER_ENABLED=1 to explicitly enable the continuous crawler");
  const config = loadWorkerConfig();
  await assertCrawlHistoryDatabase();
  await crawlWorkerLogger.log({ level: "info", event: "worker.started", details: { sources: config.sources, routeCount: config.routes.length, horizonDays: config.horizonDays, intervalMinutes: config.intervalMs / 60_000, requestDelayMs: config.requestDelayMs } });
  let stopping = false;
  let wakeSleep: (() => void) | null = null;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    void crawlWorkerLogger.log({ level: "info", event: "worker.stop_requested", message: signal });
    wakeSleep?.();
  };
  const onSigterm = () => stop("SIGTERM");
  const onSigint = () => stop("SIGINT");
  process.once("SIGTERM", onSigterm);
  process.once("SIGINT", onSigint);
  try {
    while (!stopping) {
      await writeCrawlWorkerStatus({ state: "running", heartbeatAt: new Date().toISOString() });
      try {
        const result = await runWorkerCycle(config);
        const heartbeatAt = new Date().toISOString();
        await writeCrawlWorkerStatus({ state: "running", heartbeatAt, lastCycleAt: heartbeatAt, lastCycle: result, ...(result.lastError ? { lastError: result.lastError.slice(0, 500) } : {}) });
      } catch (error) {
        const message = errorMessage(error);
        await crawlWorkerLogger.log({ level: "error", event: "cycle.aborted", message });
        await writeCrawlWorkerStatus({ state: "error", heartbeatAt: new Date().toISOString(), lastError: message.slice(0, 500) });
      }
      if (!stopping) await sleepUntilNextCycle(config.intervalMs, (wake) => { wakeSleep = wake; });
      wakeSleep = null;
    }
  } finally {
    process.off("SIGTERM", onSigterm);
    process.off("SIGINT", onSigint);
    await writeCrawlWorkerStatus({ state: "stopped", heartbeatAt: new Date().toISOString() });
    await crawlWorkerLogger.log({ level: "info", event: "worker.stopped" });
    process.exitCode = 0;
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const secret = process.env.SECRET_TOROB?.trim();
  return (secret ? message.replaceAll(secret, "[REDACTED]") : message).replace(/SECRET_TOROB\s*[:=]\s*[^\s,;]+/gi, "SECRET_TOROB=[REDACTED]").slice(0, 500);
}

async function sleepUntilNextCycle(intervalMs: number, setWake: (wake: () => void) => void): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, intervalMs);
    setWake(() => { clearTimeout(timer); resolve(); });
  });
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
