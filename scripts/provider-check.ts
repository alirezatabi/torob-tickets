#!/usr/bin/env tsx
/**
 * Provider connectivity check — the *manual* command, deliberately separate from tests.
 *
 *   npm run provider:check             # every configured provider
 *   npm run provider:check sepehr360   # one provider
 *
 * Why separate from `npm test`: unit tests must never touch a live site (they use
 * fixtures). This script is the opposite — it exists so a human can verify, on their own
 * machine, that the connector still works against the real source.
 *
 * Output is a sanitised, paste-able report: no cookies, no tokens, no full HTML.
 */

import { AmadeusAdapter, amadeusConfigFromEnv } from "../src/modules/providers/amadeus/adapter";
import { Sepehr360Adapter, sepehr360ConfigFromEnv } from "../src/modules/providers/sepehr360/adapter";
import type { LiveProviderAdapter, ProviderSearchRequest } from "../src/modules/providers/contracts/provider";
import { createLogger } from "../src/modules/providers/shared/logger";
import type { TripQuery } from "../src/domain/trip";
import { DEFAULT_PREFERENCES } from "../src/domain/trip";

const providerArg = process.argv[2] ?? "all";
const origin = (process.argv[3] ?? "THR").toUpperCase();
const destination = (process.argv[4] ?? "MHD").toUpperCase();
const departDate = process.argv[5] ?? defaultDate();

function defaultDate(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString().slice(0, 10);
}

function query(): TripQuery {
  return {
    mode: "flight",
    tripType: "oneway",
    originCode: origin,
    destinationCode: destination,
    departDate,
    passengers: 1,
    cabin: "economy",
    filters: DEFAULT_PREFERENCES,
    rawText: undefined,
  } as unknown as TripQuery;
}

function request(): ProviderSearchRequest {
  const international = origin !== destination && !["MHD", "SYZ", "IFN", "TBZ", "KIH", "AWZ", "BND"].includes(destination);
  return {
    query: query(),
    originCity: origin,
    destinationCity: destination,
    originAirports: [international ? "IKA" : "THR"],
    destinationAirports: [destination],
    departDate,
    passengers: 1,
    cabin: "economy",
    international,
  };
}

function pick(): LiveProviderAdapter<unknown>[] {
  const providers: LiveProviderAdapter<unknown>[] = [];
  const sepehr = new Sepehr360Adapter(sepehr360ConfigFromEnv());
  const amadeus = new AmadeusAdapter(amadeusConfigFromEnv());

  if (providerArg === "all" || providerArg === "sepehr360") providers.push(sepehr as unknown as LiveProviderAdapter<unknown>);
  if (providerArg === "all" || providerArg === "amadeus") providers.push(amadeus as unknown as LiveProviderAdapter<unknown>);
  return providers;
}

async function checkProvider(provider: LiveProviderAdapter<unknown>): Promise<void> {
  const line = "─".repeat(64);
  console.log(`\n${line}\n▶ ${provider.name} (${provider.id}) — ${provider.sourceKind}`);
  console.log(`  endpoint: ${provider.id === "sepehr360" ? "GET /Flight/B2c/Search" : "GET /v2/shopping/flight-offers"}`);
  console.log(`  mode: ${provider.isConfigured() ? "configured" : "NOT CONFIGURED"}`);

  if (!provider.isConfigured()) {
    console.log("  نتیجه: رد شد — کلید/تنظیمات لازم موجود نیست (این خطا نیست، پیکربندی است).");
    return;
  }

  const startedAt = Date.now();
  try {
    const result = await provider.search(request(), {
      signal: AbortSignal.timeout(20_000),
      logger: createLogger(`${provider.id}:check`),
      now: () => new Date(),
      budgetMs: 20_000,
    });
    const batch = provider.normalize(result.records, request(), result.meta);
    const latency = Date.now() - startedAt;

    console.log(`  HTTP: ${result.meta.httpStatus} | ${latency} ms | retries ${result.meta.retries}`);
    console.log(`  raw rows: ${result.rawCount} | accepted: ${batch.offers.length} | rejected: ${batch.issues.length}`);
    if (result.warnings.length > 0) console.log(`  warnings: ${result.warnings.join(", ")}`);

    const sample = batch.offers.slice(0, 3);
    if (sample.length === 0) {
      console.log("  نتیجه: اتصال برقرار شد اما نرخی استخراج نشد (یا مسیر خالی است یا قالب صفحه تغییر کرده).");
    } else {
      console.log("  نمونهٔ نرمال‌شده (۳ مورد اول):");
      for (const offer of sample) {
        console.log(
          [
            `    • ${offer.airlineCode} ${offer.flightNumber ?? "(بدون شماره)"}`,
            `      ${offer.originAirport ?? offer.originCode}→${offer.destinationAirport ?? offer.destinationCode}`,
            `      ${offer.departAt} → ${offer.arriveAt}`,
            `      ${offer.durationMinutes}min · stops ${offer.stops}`,
            `      ${offer.price.comparable === false ? `${offer.price.original.amount / 100} ${offer.price.original.currency}` : `${offer.price.toman.toLocaleString("en-US")} toman`}`,
            `      freshness=${offer.freshness} completeness=${offer.completeness}`,
            `      id=${offer.id.slice(0, 80)}`,
          ].join("\n"),
        );
      }
    }

    const rejected = batch.issues.slice(0, 3);
    if (rejected.length > 0) {
      console.log("  رکوردهای ردشده (نمونه):");
      for (const issue of rejected) console.log(`    - [${issue.code}] raw#${issue.rawId}: ${issue.message}`);
    }
  } catch (error) {
    const info = error as { code?: string; summaryFa?: string; detail?: string; retryable?: boolean };
    console.log(`  نتیجه: خطا — ${info.code ?? "unknown"} | ${info.summaryFa ?? "?"}`);
    if (info.detail) console.log(`  جزئیات (سرور): ${String(info.detail).slice(0, 240)}`);
    if (info.code === "prohibited") {
      console.log("  ⚠ منبع دسترسی را محدود کرده است. این وضعیت تکرار/دور زدن ندارد؛ همان‌جا متوقف می‌شویم.");
    }
    if (info.code === "parse") {
      console.log("  ⚠ قالب صفحه تغییر کرده است. fixture تازه از همان پاسخ بگیرید و parser را به‌روز کنید.");
    }
  }
}

async function main(): Promise<void> {
  console.log("Torob Tickets — بررسی اتصال به منابع واقعی");
  console.log(`مسیر: ${origin} → ${destination} | تاریخ: ${departDate}`);
  console.log("این اسکریپت فقط-خواندنی است و برای هر منبع تنها یک درخواست می‌فرستد.");

  const providers = pick();
  if (providers.length === 0) {
    console.error(`منبع ناشناخته: ${providerArg}`);
    process.exitCode = 2;
    return;
  }

  for (const provider of providers) {
    await checkProvider(provider);
  }

  console.log("\nپایان. برای جست‌وجوی کامل: npm run search:live");
}

void main();
