import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CrawlSnapshot } from "./types";

export const CRAWL_DATA_DIR = join(process.cwd(), "data", "crawl");
export const LATEST_CRAWL_PATH = join(CRAWL_DATA_DIR, "latest.json");
export function latestSnapshotPath(source: string): string { return join(CRAWL_DATA_DIR, source, "latest.json"); }

export interface CrawlSnapshotFile {
  schemaVersion: 1;
  generatedAt: string;
  snapshots: CrawlSnapshot[];
}

/** Store per-source files plus a single, commit-ready data/crawl/latest.json manifest. */
export async function writeSnapshot(snapshot: CrawlSnapshot, root = CRAWL_DATA_DIR): Promise<string> {
  if (snapshot.source === "synthetic-test") throw new Error("Refusing to store synthetic-test data as a crawl snapshot");
  const sourcePath = join(root, snapshot.source, "latest.json");
  await atomicWrite(sourcePath, `${JSON.stringify(snapshot, null, 2)}\n`);

  const latestPath = join(root, "latest.json");
  const previous = await readSnapshotFile(latestPath);
  const snapshots = (previous?.snapshots ?? []).filter((item) => item.source !== snapshot.source && item.source !== "synthetic-test");
  snapshots.push(snapshot);
  const manifest: CrawlSnapshotFile = { schemaVersion: 1, generatedAt: new Date().toISOString(), snapshots };
  await atomicWrite(latestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return latestPath;
}

export async function readSnapshot(source: string, root = CRAWL_DATA_DIR): Promise<CrawlSnapshot | null> {
  if (source === "synthetic-test") return null;
  try {
    const value: unknown = JSON.parse(await readFile(join(root, source, "latest.json"), "utf8"));
    if (isSnapshot(value) && value.source === source && value.source !== "synthetic-test") return value;
  } catch { /* Fall through to the aggregate latest file. */ }
  const manifest = await readSnapshotFile(join(root, "latest.json"));
  return manifest?.snapshots.find((item) => item.source === source && item.source !== "synthetic-test") ?? null;
}

export function isSnapshot(value: unknown): value is CrawlSnapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CrawlSnapshot>;
  return item.schemaVersion === 1 && typeof item.source === "string" && typeof item.fetchedAt === "string" && typeof item.route === "string" && typeof item.date === "string" && Array.isArray(item.offers);
}

async function readSnapshotFile(path: string): Promise<CrawlSnapshotFile | null> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!value || typeof value !== "object") return null;
    const file = value as Partial<CrawlSnapshotFile>;
    if (file.schemaVersion !== 1 || !Array.isArray(file.snapshots)) return null;
    return { schemaVersion: 1, generatedAt: typeof file.generatedAt === "string" ? file.generatedAt : "", snapshots: file.snapshots.filter(isSnapshot).filter((item) => item.source !== "synthetic-test") };
  } catch { return null; }
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, contents, { mode: 0o600 });
  await rename(temp, path);
}
