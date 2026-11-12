#!/usr/bin/env tsx
/**
 * Capture a real provider response as a test fixture.
 *
 *   npm run fixtures:refresh -- sepehr360 THR MHD 2026-11-20
 *
 * Why this exists: the parsers are content-driven precisely because the sources are not
 * contract-bound. When a source changes its markup, the fix is (a) capture one page,
 * (b) update the parser, (c) add the page to the fixture set. This script performs (a)
 * with the *same* HTTP client, robots check and rate limits as production — so capturing
 * is no more intrusive than one user search.
 *
 * It writes to `src/modules/providers/<id>/__fixtures__/captured-<route>-<date>.html`
 * after stripping nothing but tracking params; it does NOT write to the live dataset.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { buildSearchUrl } from "../src/modules/providers/sepehr360/url";
import { HttpClient } from "../src/modules/providers/shared/http";
import { createLogger } from "../src/modules/providers/shared/logger";
import { SEPEHR360_HOST } from "../src/modules/providers/sepehr360/url";

const [providerArg, originArg, destinationArg, dateArg] = process.argv.slice(2);

if (providerArg !== "sepehr360") {
  console.error("استفاده: npm run fixtures:refresh -- sepehr360 <ORIGIN> <DEST> <YYYY-MM-DD>");
  console.error("(Amadeus یک API رسمی است و پاسخش را می‌توان از لاگ نمونه برداشت؛ برای آن fixture دستی ساخته می‌شود.)");
  process.exit(2);
}
if (!originArg || !destinationArg || !dateArg) {
  console.error("مسیر و تاریخ لازم است: npm run fixtures:refresh -- sepehr360 THR MHD 2026-11-20");
  process.exit(2);
}

async function main(): Promise<void> {
  const url = buildSearchUrl({
    originCity: originArg!.toUpperCase(),
    destinationCity: destinationArg!.toUpperCase(),
    departDate: dateArg!,
  });

  console.log(`دریافت ${url.url}`);
  console.log("یک درخواست، با احترام به robots.txt و محدودیت نرخ.\n");

  const http = new HttpClient({
    allowedHosts: [SEPEHR360_HOST],
    robotsHosts: [SEPEHR360_HOST],
    timeoutMs: 10_000,
    maxBytes: 3_000_000,
    rateLimit: { capacity: 1, windowMs: 5_000 },
    logger: createLogger("fixtures"),
  });

  const response = await http.request({ url: url.url, label: "fixture-capture" });
  const target = path.join(
    process.cwd(),
    "src/modules/providers/sepehr360/__fixtures__",
    `captured-${originArg}-${destinationArg}-${dateArg}.html`,
  );
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, response.body, "utf8");

  // Sanity check: does the current parser still understand this page?
  const { parseSearchPage } = await import("../src/modules/providers/sepehr360/parser");
  const parsed = parseSearchPage(response.body);
  console.log(`ذخیره شد: ${path.relative(process.cwd(), target)} (${response.body.length} بایت)`);
  console.log(`کارت‌های شناسایی‌شده: ${parsed.offers.length} | اعلام‌شده: ${parsed.meta.resultCount ?? "?"}`);
  if (parsed.warnings.length > 0) console.log(`هشدارها: ${parsed.warnings.join(", ")}`);
  if (parsed.offers.length === 0 && !parsed.meta.emptyState) {
    console.log("\n⚠ parser چیزی پیدا نکرد. قالب صفحه تغییر کرده؛ parser را بر اساس همین فایل به‌روز کنید.");
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error("خطا:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

