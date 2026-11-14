import { NextResponse } from "next/server";

import { checkDatabase, dbMode } from "@/modules/db/prisma";
import { describeDemoProviders, SEARCH_MODE } from "@/modules/catalog/demo-providers";
import { CRAWL_SOURCES, CRAWLER_PARSER_STATUS } from "@/crawler/sources";
import { getCrawlSnapshots } from "@/crawler/snapshot-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — operational status, no secrets.
 *
 * Shows, honestly: that the only data source is the demo dataset, which demo providers
 * exist, and whether the database answers. Deliberately not a "green checkmark" —
 * `degraded` is a normal, expected state here.
 */
export async function GET() {
  const db = await checkDatabase();
  const providers = describeDemoProviders();
  const crawlSnapshots = await getCrawlSnapshots(CRAWL_SOURCES.map((source) => source.id));

  return NextResponse.json(
    {
      status: db.ok ? "ok" : "degraded",
      mode: SEARCH_MODE,
      dataSource: {
        kind: "demo",
        noteFa: "جستجوی فعلی از دادهٔ نمونه استفاده می‌کند؛ خزش شبکه‌ای در درخواست کاربر اجرا نمی‌شود.",
      },
      crawler: {
        enabledForLocalJobs: process.env.CRAWLER_ENABLED === "1",
        trigger: "local-cli-only",
        snapshots: crawlSnapshots.map(({ source, fetchedAt, offers }) => ({ source, fetchedAt, count: offers.length })),
        parserStatus: CRAWLER_PARSER_STATUS,
      },
      database: {
        mode: dbMode(),
        ok: db.ok,
        message: db.message,
      },
      providers: providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        sourceKind: provider.sourceKind,
        canClaimAvailability: provider.canClaimAvailability,
        missingFactsFa: provider.missingFactsFa,
      })),
      checks: {
        databaseHint: db.ok
          ? "تاریخچهٔ قیمت ثبت می‌شود."
          : "برای ثبت تاریخچه، DATABASE_URL را تنظیم و `npm run db:push` را اجرا کنید.",
        dataSourceHint: "این نسخه اتصالی به منبع بیرونی ندارد؛ همهٔ قیمت‌ها دادهٔ نمونه‌اند.",
      },
      time: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
