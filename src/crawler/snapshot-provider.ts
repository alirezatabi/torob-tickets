import { readSnapshot } from "./store";
import type { CrawlSnapshot } from "./types";

/** UI-facing read is local-only and rejects synthetic fixtures at the store boundary. */
export async function getCrawlSnapshots(sourceIds: string[]): Promise<CrawlSnapshot[]> {
  const snapshots = await Promise.all(sourceIds.map((source) => readSnapshot(source)));
  return snapshots.filter((snapshot): snapshot is CrawlSnapshot => snapshot !== null && snapshot.source !== "synthetic-test");
}
