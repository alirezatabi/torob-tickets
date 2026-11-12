#!/usr/bin/env tsx
/**
 * End-to-end live search from the command line — the manual verification path.
 *
 *   npm run search:live                          # THR→MHD, +7 days
 *   npm run search:live THR IST 2026-11-20
 *   npm run search:live THR MHD 2026-11-20 --no-persist
 *
 * It prints exactly what the app would store and show: normalized offers, ranking
 * badges, per-provider evidence, and whether price history was written. Read-only with
 * respect to the sources (one request per provider) and safe to run repeatedly.
 */

import { runLiveSearch } from "../src/server/live-search";
import type { TripQuery } from "../src/domain/trip";

const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));

const origin = (args[0] ?? "THR").toUpperCase();
const destination = (args[1] ?? "MHD").toUpperCase();
const departDate = args[2] ?? defaultDate();

function defaultDate(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString().slice(0, 10);
}

function buildQuery(): TripQuery {
  return {
    mode: "flight",
    tripType: "oneway",
    originCode: origin,
    destinationCode: destination,
    departDate,
    passengers: 1,
    cabin: "economy",
    filters: {
      pricePreference: "balanced",
      maxStops: null,
      baggageRequired: false,
      refundableOnly: false,
      maxPriceToman: null,
      dayPart: null,
      preferredAirlines: [],
    },
    rawText: undefined,
  } as unknown as TripQuery;
}

async function main(): Promise<void> {
  const mode = flags.has("--demo") ? "demo" : "live";
  console.log(`Torob Tickets — جست‌وجوی ${mode === "live" ? "واقعی" : "نمونه"}: ${origin} → ${destination} | ${departDate}\n`);

  const payload = await runLiveSearch(buildQuery(), {
    mode,
    persist: !flags.has("--no-persist"),
    sort: flags.has("--cheapest") ? "cheapest" : flags.has("--fastest") ? "fastest" : "best",
  });

  console.log(`حالت: ${payload.mode} | ${payload.offers.length} نرخ | ${payload.totalMs} ms`);
  console.log(`رتبه‌بندی: بهترین=${payload.ranking.best ?? "—"} | ارزان‌ترین=${payload.ranking.cheapest ?? "—"} | سریع‌ترین=${payload.ranking.fastest ?? "—"}`);

  console.log("\n— منابع —");
  for (const report of payload.reports) {
    const state = report.ok
      ? `OK  accepted=${report.accepted} rejected=${report.rejected} raw=${report.rawCount}`
      : `FAIL ${report.error?.code} — ${report.error?.summaryFa}`;
    console.log(
      `  ${report.providerId.padEnd(10)} ${state} | ${report.latencyMs} ms | retries=${report.retries} | cache=${report.fromCache}`,
    );
  }

  if (payload.offers.length === 0) {
    const failed = payload.reports.filter((report) => !report.ok);
    if (failed.length > 0) {
      // "No offers" because a provider failed is a different fact from "no flights".
      console.log("\nهیچ نرخی برنگشت، چون هیچ منبعی نرخ معتبر برنگرداند (دلیل هر منبع بالا آمده است).");
    } else {
      console.log("\nهیچ نرخی برنگشت؛ منابع پاسخ دادند و برای این مسیر/تاریخ نرخی نداشتند.");
    }
  } else {
    console.log("\n— نرخ‌ها —");
    for (const offer of payload.offers) {
      const price =
        offer.price.comparable === false
          ? `${(offer.price.amountMinor / 100).toFixed(2)} ${offer.price.currency}`
          : `${offer.price.toman.toLocaleString("en-US")} toman`;
      console.log(
        [
          `  ${String(offer.badges.join(",") || "-").padEnd(18)} ${offer.providerId.padEnd(10)} ${offer.airlineCode} ${offer.flightNumber ?? "(no-number)"}`,
          `${offer.departAt} → ${offer.arriveAt} (${offer.durationMinutes}m, ${offer.stops} stops)`,
          `${price}  freshness=${offer.freshness} completeness=${offer.completeness}`,
          `baggage=${offer.baggage.checked} refundable=${offer.refundable ?? "unknown"} score=${offer.score}`,
        ].join(" | "),
      );
    }
  }

  console.log("\n— تازگی —");
  const freshnessCounts = payload.offers.reduce<Record<string, number>>((acc, offer) => {
    acc[offer.freshness] = (acc[offer.freshness] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  ${JSON.stringify(freshnessCounts)}`);

  console.log("\n— ذخیره‌سازی —");
  if (!payload.persistence.attempted) console.log(`  ثبت نشد: ${payload.persistence.reasonFa}`);
  else if (payload.persistence.ok)
    console.log(
      `  ثبت شد: searchId=${payload.persistence.searchId}${payload.persistence.deduped ? " (درخواست تکراری ادغام شد)" : ""}`,
    );
  else console.log(`  خطا در ثبت: ${payload.persistence.reasonFa}`);

  if (payload.persistence.attempted && payload.persistence.searchId) {
    console.log(
      `\nبرای دیدن تاریخچه: npm run db:history -- ${payload.query.originCity} ${payload.query.destinationCity} ${payload.query.departDate}`,
    );
  }

  if (payload.offers.length === 0 && mode === "live") process.exitCode = 1;
}

void main();
