import { NextResponse } from "next/server";

import { checkDatabase, dbMode } from "@/modules/db/prisma";
import { getCrawlSnapshots } from "@/crawler/snapshot-provider";
import { readCrawlWorkerStatus } from "@/crawler/worker-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/health — reports local Safarmarket snapshot and worker status, without secrets. */
export async function GET() {
  const [database, worker, snapshots] = await Promise.all([
    checkDatabase(),
    readCrawlWorkerStatus(),
    getCrawlSnapshots(["safarmarket"]),
  ]);
  const snapshotSummaries = snapshots.map(({ source, fetchedAt, route, date, offers }) => ({
    source,
    fetchedAt,
    route,
    date,
    rawOfferCount: offers.length,
  }));
  const status = database.ok && worker?.state === "running" ? "ok" : "degraded";

  return NextResponse.json({
    status,
    dataSource: {
      kind: "safarmarket-local-snapshot",
      noteFa: "فقط snapshotهای واقعی ذخیره‌شده نمایش داده می‌شوند؛ این endpoint خودش crawl اجرا نمی‌کند.",
    },
    crawler: {
      enabledForLocalJobs: process.env.CRAWLER_ENABLED === "1",
      trigger: "separate-worker-process",
      worker,
      snapshots: snapshotSummaries,
    },
    database: { mode: dbMode(), ok: database.ok, message: database.message },
    providers: [{ id: "safarmarket", name: "Safarmarket", mode: "crawled", snapshotCount: snapshotSummaries.length }],
    checks: {
      databaseHint: database.ok ? "تاریخچهٔ قیمت در PostgreSQL قابل ثبت است." : "برای تاریخچه DATABASE_URL و schema دیتابیس لازم است.",
      dataSourceHint: "جست‌وجو فقط از snapshot واقعی محلی Safarmarket می‌خواند؛ نبود snapshot به دادهٔ ساختگی تبدیل نمی‌شود.",
    },
    time: new Date().toISOString(),
  }, { headers: { "cache-control": "no-store" } });
}
