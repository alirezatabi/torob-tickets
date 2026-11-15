import { readSnapshotsForSources } from "./store";
import type { CrawlSnapshot } from "./types";

/** UI-facing read is local-only and rejects synthetic fixtures at the store boundary. */
export async function getCrawlSnapshots(sourceIds: string[]): Promise<CrawlSnapshot[]> {
  const snapshots = await readSnapshotsForSources(sourceIds);
  return snapshots.filter((snapshot) => snapshot.source !== "synthetic-test");
}
