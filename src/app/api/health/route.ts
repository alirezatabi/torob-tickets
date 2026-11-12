import { NextResponse } from "next/server";

import { checkDatabase, dbMode } from "@/modules/db/prisma";
import { describeLiveProviders, searchMode } from "@/modules/providers/registry-live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — operational status, no secrets.
 *
 * Shows, honestly: which search mode is active, which providers are configured, whether
 * the database answers, and the env var each missing piece needs. Deliberately not a
 * "green checkmark" — `degraded` is a normal, expected state here.
 */
export async function GET() {
  const db = await checkDatabase();
  const providers = describeLiveProviders();
  const mode = searchMode();

  const configured = providers.filter((provider) => provider.configured);
  const status = !db.ok ? "degraded" : configured.length === 0 ? "degraded" : "ok";

  return NextResponse.json(
    {
      status,
      mode,
      database: {
        mode: dbMode(),
        ok: db.ok,
        message: db.message,
      },
      providers: providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        configured: provider.configured,
        sourceKind: provider.sourceKind,
        canClaimAvailability: provider.canClaimAvailability,
        missingFactsFa: provider.missingFactsFa,
      })),
      checks: {
        // Actionable hints instead of a boolean soup.
        searchModeHint:
          mode === "live"
            ? "حالت واقعی فعال است؛ جست‌وجوها به منابع بیرونی وصل می‌شوند."
            : "حالت نمونه فعال است. برای دادهٔ واقعی، TOROB_SEARCH_MODE=live را تنظیم کنید.",
        databaseHint: db.ok
          ? "تاریخچهٔ قیمت ثبت می‌شود."
          : "برای ثبت تاریخچه، DATABASE_URL را تنظیم و `npm run db:push` را اجرا کنید.",
        amadeusHint: providers.find((provider) => provider.id === "amadeus")?.configured
          ? "کلیدهای Amadeus تنظیم شده‌اند."
          : "برای فعال‌سازی Amadeus، AMADEUS_CLIENT_ID/SECRET را تنظیم کنید.",
      },
      time: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
