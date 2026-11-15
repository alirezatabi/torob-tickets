import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrawlWorkerLogger } from "@/crawler/worker-logger";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "crawl-worker-logs-"));
  directories.push(directory);
  return directory;
}

describe("continuous worker logging", () => {
  it("writes structured JSONL and redacts credential fields and configured secret values", async () => {
    const directory = await tempDirectory();
    vi.stubEnv("SECRET_TOROB", "unit-test-secret-value");
    const logger = new CrawlWorkerLogger({ directory, consoleOutput: false });
    await logger.log({
      level: "error", event: "query.failed", source: "basisfly", route: "MHD-THR", date: "2026-11-15",
      message: "Request failed with unit-test-secret-value",
      details: { secretTorob: "unit-test-secret-value", reason: "failed unit-test-secret-value" },
    });
    const [line] = (await readFile(join(directory, "worker.jsonl"), "utf8")).trim().split("\n");
    const record = JSON.parse(line!) as Record<string, unknown>;
    expect(record).toMatchObject({ level: "error", event: "query.failed", source: "basisfly", route: "MHD-THR" });
    expect(JSON.stringify(record)).not.toContain("unit-test-secret-value");
    expect(JSON.stringify(record)).toContain("[REDACTED]");
  });

  it("rotates bounded logs and keeps only the configured number of backups", async () => {
    const directory = await tempDirectory();
    const logger = new CrawlWorkerLogger({ directory, maxBytes: 1024, backups: 2, consoleOutput: false });
    for (let index = 0; index < 50; index += 1) {
      await logger.log({ level: "info", event: "test.rotation", message: `event-${index}`, details: { index, payload: "x".repeat(70) } });
    }
    const names = (await readdir(directory)).sort();
    expect(names).toEqual(["worker.jsonl", "worker.jsonl.1", "worker.jsonl.2"]);
    for (const name of names) {
      const contents = await readFile(join(directory, name), "utf8");
      expect(contents.trim().split("\n").every((line) => JSON.parse(line).event === "test.rotation")).toBe(true);
    }
  });
});
