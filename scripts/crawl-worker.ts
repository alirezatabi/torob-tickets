#!/usr/bin/env tsx
import "dotenv/config";
import { disconnectPrisma } from "../src/modules/db/prisma";
import { startCrawlWorker } from "../src/crawler/worker";
import { crawlWorkerLogger } from "../src/crawler/worker-logger";

startCrawlWorker()
  .catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    await crawlWorkerLogger.log({ level: "error", event: "worker.startup_failed", message });
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
