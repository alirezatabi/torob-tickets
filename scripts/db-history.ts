#!/usr/bin/env tsx
/**
 * Read-only price-history report.
 *
 *   npm run db:history -- THR MHD 2026-11-20
 *   npm run db:history -- THR MHD 2026-11-20 7d
 *
 * Shows one block per fare-level offer identity: how many observations exist, over what
 * window, and the price change. This is the same data the chart uses, printed so it can
 * be pasted into a bug report as evidence.
 */

import { getPriceHistory, HISTORY_RANGE_LABELS_FA, type HistoryRange } from "../src/modules/history/price-history";
import { disconnectPrisma } from "../src/modules/db/prisma";

const [originArg, destinationArg, dateArg, rangeArg] = process.argv.slice(2);
const RANGES: HistoryRange[] = ["24h", "7d", "30d", "90d", "all"];

if (!originArg || !destinationArg) {
  console.error("استفاده: npm run db:history -- <ORIGIN> <DESTINATION> [YYYY-MM-DD] [24h|7d|30d|90d|all]");
  process.exit(2);
}

const range: HistoryRange = RANGES.includes(rangeArg as HistoryRange) ? (rangeArg as HistoryRange) : "30d";

async function main(): Promise<void> {
  const result = await getPriceHistory({
    originCity: originArg?.toUpperCase(),
    destinationCity: destinationArg?.toUpperCase(),
    departDate: dateArg,
    range,
  });

  console.log(`تاریخچهٔ قیمت ${originArg} → ${destinationArg}${dateArg ? ` | ${dateArg}` : ""} | بازهٔ ${HISTORY_RANGE_LABELS_FA[range]}`);

  if (!result.available) {
    console.log(`\nدر دسترس نیست: ${result.reasonFa}`);
    console.log("نکته: تاریخچه فقط از اولین مشاهدهٔ واقعی شروع می‌شود و هیچ داده‌ای برای گذشته ساخته نمی‌شود.");
    return;
  }

  console.log(`\n${result.series.length} نرخ مستقل | ${result.pointCount} مشاهده\n`);

  for (const series of result.series) {
    console.log(`• ${series.airlineCode} ${series.flightNumber ?? "(بدون شماره)"} | ${series.originAirport ?? "?"}→${series.destinationAirport ?? "?"}`);
    console.log(`  پرواز: ${series.departDate} | کابین: ${series.cabin} | کلاس: ${series.fareClass ?? "?"} | بار: ${series.baggageSignature} | ${series.ticketType}`);
    console.log(`  مشاهدات: ${series.points.length} | کمینه ${series.minToman.toLocaleString("en-US")} | بیشینه ${series.maxToman.toLocaleString("en-US")}`);
    console.log(`  اولین: ${series.firstObservedAt} | آخرین: ${series.lastObservedAt}${series.changePct === null ? "" : ` | تغییر ${series.changePct}%`}`);
    const tail = series.points.slice(-5);
    for (const point of tail) {
      console.log(`    - ${point.observedAt}  ${point.priceToman.toLocaleString("en-US")}  (${point.freshness}, ${point.providerId})`);
    }
    console.log("");
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
