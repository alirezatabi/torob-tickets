#!/usr/bin/env tsx
/**
 * Database doctor — read-only diagnosis for the operational path.
 *
 *   npm run db:doctor
 *
 * Answers, in order: is DATABASE_URL set? does Postgres answer? does the v2 schema
 * exist? are there searches/offers/observations, and how old is the newest one? Each
 * failure prints the command that fixes it.
 */

import { checkDatabase, dbMode, disconnectPrisma, getDb, isDatabaseConfigured } from "../src/modules/db/prisma";

const V2_TABLES = [
  "live_providers",
  "flight_searches",
  "provider_fetch_logs",
  "flight_offers",
  "price_observations",
  "search_snapshots",
];

async function main(): Promise<void> {
  console.log("Torob Tickets — بررسی وضعیت دیتابیس\n");

  console.log(`DATABASE_URL: ${isDatabaseConfigured() ? "تنظیم شده" : "تنظیم نشده"}`);
  console.log(`حالت: ${dbMode()}`);

  if (dbMode() === "off") {
    console.log("\nبرای مسیر واقعی:");
    console.log('  1) CREATE DATABASE torob_tickets;');
    console.log('  2) $env:DATABASE_URL="postgresql://postgres:PASS@localhost:5432/torob_tickets?schema=public"');
    console.log("  3) npm run db:generate; npm run db:push; npm run db:seed");
    return;
  }

  const health = await checkDatabase();
  console.log(`\nاتصال: ${health.ok ? "برقرار" : "ناموفق"} — ${health.message}`);
  if (!health.ok) {
    console.log("راه‌حل: سرویس PostgreSQL را اجرا و DATABASE_URL را بررسی کنید.");
    return;
  }

  const db = getDb();
  console.log("\nجدول‌ها:");
  for (const table of V2_TABLES) {
    try {
      // A cheap, read-only probe per table.
      const rows = await probe(table, db);
      console.log(`  ✓ ${table}${rows === null ? "" : ` (${rows} ردیف قابل خواندن)`}`);
    } catch (error) {
      console.log(`  ✗ ${table} — ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      console.log("    راه‌حل: npm run db:push (ساخت جدول‌ها) و npm run db:generate (کلاینت).");
    }
  }

  try {
    const searches = await db.flightSearch.findFirst({ orderBy: { startedAt: "desc" } });
    const offers = await db.flightOffer.findMany({ take: 1 });
    const observations = await db.priceObservation.findMany({ take: 1, orderBy: { observedAt: "desc" } });

    console.log("\nداده‌ها:");
    console.log(
      `  جست‌وجوها: ${searches ? `آخرین ${searches.startedAt ? new Date(searches.startedAt).toISOString() : "?"} (${searches.status})` : "هیچ"}`,
    );
    console.log(`  نرخ‌ها: ${offers.length > 0 ? "موجود" : "هیچ"}`);
    console.log(`  مشاهدات قیمت: ${observations.length > 0 ? `آخرین ${observations[0]?.observedAt.toISOString()}` : "هیچ"}`);
  } catch {
    console.log("\n(آمار خوانده نشد؛ ابتدا جدول‌ها را بسازید.)");
  }
}

async function probe(table: string, db: ReturnType<typeof getDb>): Promise<number | null> {
  switch (table) {
    case "flight_searches":
      return (await db.flightSearch.findFirst()) === null ? 0 : 1;
    case "flight_offers":
      return (await db.flightOffer.findMany({ take: 1 })).length;
    case "price_observations":
      return (await db.priceObservation.findMany({ take: 1 })).length;
    case "provider_fetch_logs":
      return (await db.providerFetchLog.findMany({ take: 1 })).length;
    case "live_providers":
    case "search_snapshots":
      return (await db.searchSnapshot.findFirst()) === null ? 0 : 1;
    default:
      return null;
  }
}

main()
  .catch((error: unknown) => {
    console.error("خطا:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    void disconnectPrisma();
  });
