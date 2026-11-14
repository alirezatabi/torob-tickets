import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile } from "./atomic-file";
import type { CrawlSnapshot } from "./types";

export const CRAWL_DATA_DIR = join(process.cwd(), "data", "crawl");
export const LATEST_CRAWL_PATH = join(CRAWL_DATA_DIR, "latest.json");
export function latestSnapshotPath(source: string): string { return join(CRAWL_DATA_DIR, source, "latest.json"); }

export interface CrawlSnapshotFile {
  schemaVersion: 1;
  generatedAt: string;
  /** Latest raw snapshot per source + route + departure date. */
  snapshots: CrawlSnapshot[];
}

/** Store per-route/date snapshots, a per-source latest file, and the aggregate manifest. */
export async function writeSnapshot(snapshot: CrawlSnapshot, root = CRAWL_DATA_DIR): Promise<string> {
  if (snapshot.source === "synthetic-test") throw new Error("Refusing to store synthetic-test data as a crawl snapshot");
  if (!/^[a-z0-9-]+$/i.test(snapshot.source) || !/^[A-Z]{3}-[A-Z]{3}$/.test(snapshot.route) || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.date)) {
    throw new Error("Snapshot source, route, or date is invalid");
  }

  const sourceDir = join(root, snapshot.source);
  const routePath = join(sourceDir, `${snapshot.route}-${snapshot.date}.json`);
  const latestSourcePath = join(sourceDir, "latest.json");
  const encoded = `${JSON.stringify(snapshot, null, 2)}\n`;
  await atomicWrite(routePath, encoded);
  await atomicWrite(latestSourcePath, encoded);

  const latestPath = join(root, "latest.json");
  const previous = await readSnapshotFile(latestPath);
  const key = snapshotKey(snapshot);
  const snapshots = (previous?.snapshots ?? []).filter((item) => item.source !== "synthetic-test" && snapshotKey(item) !== key);
  snapshots.push(snapshot);
  snapshots.sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
  const manifest: CrawlSnapshotFile = { schemaVersion: 1, generatedAt: new Date().toISOString(), snapshots };
  await atomicWrite(latestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return latestPath;
}

/** Read one source, optionally selecting the exact route/date rather than its latest file. */
export async function readSnapshot(
  source: string,
  root = CRAWL_DATA_DIR,
  selection?: { route: string; date: string },
): Promise<CrawlSnapshot | null> {
  if (source === "synthetic-test") return null;
  if (selection) {
    const route = selection.route.toUpperCase();
    if (!/^[A-Z]{3}-[A-Z]{3}$/.test(route) || !/^\d{4}-\d{2}-\d{2}$/.test(selection.date)) return null;
    const manifest = await readSnapshotFile(join(root, "latest.json"));
    const indexed = manifest?.snapshots.find((item) => item.source === source && item.route.toUpperCase() === route && item.date === selection.date);
    if (indexed) return indexed;
    try {
      const value: unknown = JSON.parse(await readFile(join(root, source, `${route}-${selection.date}.json`), "utf8"));
      if (isSnapshot(value) && value.source === source && value.route.toUpperCase() === route && value.date === selection.date) return value;
    } catch { /* Fall through to the legacy per-source latest file. */ }
  }
  try {
    const value: unknown = JSON.parse(await readFile(join(root, source, "latest.json"), "utf8"));
    if (isSnapshot(value) && value.source === source && value.source !== "synthetic-test") {
      if (!selection || (value.route.toUpperCase() === selection.route.toUpperCase() && value.date === selection.date)) return value;
    }
  } catch { /* Fall through to the aggregate latest file. */ }
  const manifest = await readSnapshotFile(join(root, "latest.json"));
  const candidates = (manifest?.snapshots ?? []).filter((item) =>
    item.source === source && item.source !== "synthetic-test" &&
    (!selection || (item.route.toUpperCase() === selection.route.toUpperCase() && item.date === selection.date)),
  );
  return candidates.sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))[0] ?? null;
}

/** Read all route/date entries for the requested sources without triggering any crawl. */
export async function readSnapshotsForSources(sourceIds: string[], root = CRAWL_DATA_DIR): Promise<CrawlSnapshot[]> {
  const manifest = await readSnapshotFile(join(root, "latest.json"));
  if (manifest) {
    const allowed = new Set(sourceIds.filter((source) => source !== "synthetic-test"));
    return manifest.snapshots.filter((snapshot) => allowed.has(snapshot.source));
  }
  const latest = await Promise.all(sourceIds.map((source) => readSnapshot(source, root)));
  return latest.filter((snapshot): snapshot is CrawlSnapshot => snapshot !== null);
}

export function isSnapshot(value: unknown): value is CrawlSnapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CrawlSnapshot>;
  return item.schemaVersion === 1 && typeof item.source === "string" && typeof item.fetchedAt === "string" && typeof item.route === "string" && typeof item.date === "string" && Array.isArray(item.offers);
}

function snapshotKey(snapshot: CrawlSnapshot): string {
  return `${snapshot.source}|${snapshot.route.toUpperCase()}|${snapshot.date}`;
}

async function readSnapshotFile(path: string): Promise<CrawlSnapshotFile | null> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!value || typeof value !== "object") return null;
    const file = value as Partial<CrawlSnapshotFile>;
    if (file.schemaVersion !== 1 || !Array.isArray(file.snapshots)) return null;
    const snapshots = file.snapshots.filter(isSnapshot).filter((item) => item.source !== "synthetic-test");
    return { schemaVersion: 1, generatedAt: typeof file.generatedAt === "string" ? file.generatedAt : "", snapshots };
  } catch { return null; }
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await atomicWriteFile(path, contents);
}
