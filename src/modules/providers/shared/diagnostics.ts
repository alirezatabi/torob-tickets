/**
 * Diagnostics for HTML connectors.
 *
 * Why this exists: the parser is content-driven (see `sepehr360/parser.ts`), so when it
 * returns nothing the *only* honest statement is "we do not know what this page is".
 * The old message guessed ("markup may have changed") without any evidence, and there
 * was no way to fix it without editing code.
 *
 * Two rules shape this file:
 *   • **No raw HTML is ever written.** The snapshot contains the page title, the
 *     headings, and a handful of short numeric snippets — enough to see *why* nothing
 *     parsed, never enough to republish the source's content.
 *   • Diagnostics are advisory. They never change which offers are accepted; they only
 *     explain an empty result and tell the operator the next action.
 */

import * as cheerio from "cheerio";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { normalizeDigits } from "@/modules/money/price";

/**
 * What an empty parse actually means. These are *different* problems with different
 * fixes, and conflating them (as a generic `parse` error did) sends you looking in the
 * wrong place:
 *   • `results-require-js` — the page is a shell; the numbers arrive from the site's own
 *     JSON endpoint, so an HTML parser will never see them;
 *   • `markup-changed` — cards exist but none of our field patterns matched;
 *   • `unknown-page` — none of the above; we genuinely do not know this page.
 */
export type EmptyReason = "results-require-js" | "markup-changed" | "unknown-page";

export interface PageDiagnostics {
  /** Page `<title>`. */
  title: string | null;
  /** `h1`–`h3` text, first three. */
  headings: string[];
  /** Persian sentences promising results ("برای مشاهده…"), which mark a JS shell. */
  loaderHints: string[];
  /** Short snippets containing a 4+ digit number — the closest thing to a price. */
  numericSnippets: string[];
  /** Number of `<script>` tags; a heavy script count plus no content means CSR. */
  scriptCount: number;
  /** Body text length after removing scripts/styles — a shell page is tiny. */
  textLength: number;
  reason: EmptyReason;
}

const LOADER_PATTERNS = [
  /در\s*حال\s*(?:جست\s*و?\s*جو|بارگذاری|دریافت)/,
  /لطفا\s*(?:صبر|کمی\s*صبر)/,
  /برای\s*مشاهده\s*(?:نتیجه|پرواز|بلیط)/,
  /نتیجه\s*ای\s*(?:یافت|پیدا)\s*نشد/,
  /جست\s*و?\s*جو\s*در\s*حال\s*انجام/,
];

/**
 * Inspect a response that produced no offers and say *why*, with evidence.
 * Content-driven heuristics, in order of certainty.
 */
export function diagnosePage(html: string, hasResultCards: boolean): PageDiagnostics {
  const $ = cheerio.load(html);
  const scriptCount = $("script").length;
  $("script, style, noscript, template").remove();

  const title = $("title").first().text().trim() || null;
  const headings = $("h1, h2, h3")
    .toArray()
    .map((element) => normalizeDigits($(element).text()).replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 1)
    .slice(0, 3);

  const text = normalizeDigits($("body").text() || $.root().text()).replace(/\s+/g, " ").trim();
  const loaderHints = LOADER_PATTERNS.map((pattern) => pattern.exec(text)?.[0]?.trim())
    .filter((match): match is string => Boolean(match))
    .slice(0, 3);

  // Prices are printed with separators ("5.902.000", "5,902,000", "۵٬۹۰۲٬۰۰۰"), so a
  // plain `\d{4,}` run would miss exactly the evidence we want.
  const numericSnippets = [...text.matchAll(/.{0,16}\d[\d.,\u066B\u066C\s]{3,}\d.{0,10}/g)]
    .map((match) => match[0].replace(/\s+/g, " ").trim())
    .slice(0, 6);

  let reason: EmptyReason;
  if (loaderHints.length > 0 || (scriptCount > 8 && text.length < 2_000)) {
    // The classic CSR shell: headings + a "please wait" sentence, numbers arrive later.
    reason = "results-require-js";
  } else if (hasResultCards) {
    reason = "markup-changed";
  } else {
    reason = "unknown-page";
  }

  return { title, headings, loaderHints, numericSnippets, scriptCount, textLength: text.length, reason };
}

/**
 * One-line, actionable Persian explanation of an empty parse.
 * Used verbatim in `ProviderError.detail`, in `provider:check`, and in the report chips.
 */
export function explainEmptyPage(diagnostics: PageDiagnostics): string {
  switch (diagnostics.reason) {
    case "results-require-js":
      return "نتیجه‌ها با جاوااسکریپت بارگذاری می‌شوند؛ صفحهٔ HTML هیچ نرخی ندارد (این منبع برای parser HTML مناسب نیست)";
    case "markup-changed":
      return "کارت نتیجه پیدا شد اما هیچ فیلد شناخته‌شده‌ای در آن نبود؛ قالب صفحه تغییر کرده است";
    default:
      return "پاسخ منبع شبیه صفحهٔ نتایج نیست (نه کارت نتیجه، نه حالت «نتیجه‌ای یافت نشد»)";
  }
}

/**
 * `--save-html` mode (used by `npm run provider:check … -- --save-html`): store the raw
 * response so the parser can be fixed against the real page. This is the *only* path that
 * writes source HTML, it is opt-in, and the directory is git-ignored.
 */
export function saveRawHtml(
  html: string,
  label: string,
  dir: string | undefined = process.env.SEPEHR360_SNAPSHOT_DIR,
): string | null {
  try {
    const target = path.resolve(dir ?? ".provider-snapshots");
    mkdirSync(target, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeLabel = label.replace(/[^a-zA-Z0-9>_-]/g, "");
    const file = path.join(target, `${stamp}-${safeLabel}.html`);
    writeFileSync(file, html, "utf8");
    return file;
  } catch {
    return null;
  }
}

/**
 * Write the sanitized snapshot to `SEPEHR360_SNAPSHOT_DIR` (or `./.provider-snapshots`).
 * Returns the file path, or null when writing is not possible (never throws — a failed
 * diagnostic must not turn into a failed search).
 */
export function saveSnapshot(
  diagnostics: PageDiagnostics,
  label: string,
  dir: string | undefined = process.env.SEPEHR360_SNAPSHOT_DIR,
): string | null {
  try {
    const target = path.resolve(dir ?? ".provider-snapshots");
    mkdirSync(target, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeLabel = label.replace(/[^a-zA-Z0-9>_-]/g, "");
    const file = path.join(target, `${stamp}-${safeLabel}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          label,
          note: "هیچ HTML خامی ذخیره نمی‌شود؛ فقط عنوان، سرتیترها و چند عدد کوتاه.",
          ...diagnostics,
        },
        null,
        2,
      ),
      "utf8",
    );
    return file;
  } catch {
    return null;
  }
}
