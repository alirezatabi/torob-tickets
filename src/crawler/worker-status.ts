import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile } from "./atomic-file";

export interface CrawlWorkerStatus {
  state: "running" | "stopped" | "error";
  heartbeatAt: string;
  lastCycleAt?: string;
  lastCycle?: { routesAttempted: number; snapshotsWritten: number; observationsWritten: number };
  lastError?: string;
}

const statusPath = join(process.cwd(), "data", "crawl", "worker-status.json");

export async function readCrawlWorkerStatus(): Promise<CrawlWorkerStatus | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(statusPath, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const status = parsed as CrawlWorkerStatus;
    const heartbeat = Date.parse(status.heartbeatAt);
    if (!Number.isFinite(heartbeat) || Date.now() - heartbeat > 3 * 60 * 60_000 || Date.now() < heartbeat - 60_000) return null;
    return status;
  } catch { return null; }
}

export async function writeCrawlWorkerStatus(status: CrawlWorkerStatus): Promise<void> {
  await atomicWriteFile(statusPath, `${JSON.stringify(status, null, 2)}\n`);
}
