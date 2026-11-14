#!/usr/bin/env tsx
import "dotenv/config";
import { disconnectPrisma } from "../src/modules/db/prisma";
import { startCrawlWorker } from "../src/crawler/worker";

startCrawlWorker()
  .catch((error: unknown) => {
    console.error("Crawler worker stopped:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
