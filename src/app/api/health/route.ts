import { NextResponse } from "next/server";

import { checkDatabase, dbMode } from "@/modules/db/prisma";
import { describeDemoProviders, SEARCH_MODE } from "@/modules/catalog/demo-providers";

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

  return NextResponse.json(
    {
      status: db.ok ? "ok" : "degraded",
      mode: SEARCH_MODE,
      dataSource: {
        kind: "demo",
        noteFa: "این نسخه هیچ اتصالی به منبع بیرونی ندارد؛ همهٔ قیمت‌ها دادهٔ نمونهٔ ساختگی‌اند.",
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
