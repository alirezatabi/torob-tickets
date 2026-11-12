#!/usr/bin/env tsx
/**
 * Source probe — turn *your* network access into evidence, in one command.
 *
 * Why this exists: the sandbox this project is developed in cannot reach Iranian sites, so
 * "does source X publish fares as HTML or behind an XHR?" can only be answered from a
 * machine that can. Guessing an endpoint and shipping it would be fabrication; this tool
 * asks the question properly and prints what it saw.
 *
 *   npm run source:probe -- https://www.flytoday.ir/flight/thr-mhd?departureDate=2026-11-20
 *   npm run source:probe -- <url> --save      # also writes the raw body to .provider-snapshots
 *
 * What it does, all with plain requests and the project's own User-Agent:
 *   1. GET the URL as a browser would, report status/size/title, and how many price-like
 *      numbers and clock times the *HTML itself* contains;
 *   2. look for offers embedded in the document (JSON script blocks, window state);
 *   3. list the page's own bundles and the API-looking literals inside them;
 *   4. ask the URL itself for JSON (Accept: application/json);
 *   5. if `--save` is passed, write the raw response so a parser can be built against it.
 *
 * It never bypasses a challenge, never logs in, and never crawls: one page, up to three
 * follow-ups on the same host.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  discoverOffersEndpoint,
  extractApiCandidates,
  extractEmbeddedJson,
} from "../src/modules/providers/shared/api-discovery";

const args = process.argv.slice(2);
const target = args.find((arg) => /^https?:\/\//i.test(arg));
const save = args.includes("--save");

if (!target) {
  console.error("usage: npm run source:probe -- <https-url> [--save]");
  process.exit(1);
}

const url = new URL(target);
const allowHost = (candidate: URL) => candidate.host === url.host;
const USER_AGENT =
  "TorobTicketsBot/1.0 (+https://github.com/alirezatabi/torob-tickets; demo aggregator; contact via repo)";

async function get(href: string, accept = "text/html,application/xhtml+xml,*/*;q=0.8"): Promise<{
  status: number;
  body: string;
  ms: number;
  contentType: string;
} | null> {
  const startedAt = Date.now();
  try {
    const response = await fetch(href, {
      headers: { "user-agent": USER_AGENT, accept, "accept-language": "fa-IR,fa;q=0.9,en;q=0.8" },
      redirect: "follow",
    });
    const body = await response.text();
    return {
      status: response.status,
      body,
      ms: Date.now() - startedAt,
      contentType: response.headers.get("content-type") ?? "",
    };
  } catch (error) {
    console.log(`  ✗ ${href} — ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function titleOf(html: string): string | null {
  const match = /<title[^>]*>([\s\S]{0,200}?)<\/title>/i.exec(html);
  return match?.[1]?.replace(/\s+/g, " ").trim() ?? null;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  console.log(`probe → ${url.toString()}\n`);

  const page = await get(url.toString());
  if (!page) process.exitCode = 1;
  if (!page) return;

  const text = stripTags(page.body);
  const priceish = [...text.matchAll(/\d[\d,.\u066B\u066C]{4,}\s*(?:تومان|تومن|ریال)?/g)].length;
  const clocks = [...text.matchAll(/\b([01]?\d|2[0-3]):[0-5]\d\b/g)].length;

  console.log(`1) page    status=${page.status} bytes=${page.body.length} ms=${page.ms}`);
  console.log(`   type    ${page.contentType || "-"}`);
  console.log(`   title   ${titleOf(page.body) ?? "-"}`);
  console.log(`   content numbers=${priceish} clocks=${clocks} textLength=${text.length}`);

  const embedded = extractEmbeddedJson(page.body);
  console.log(`2) embedded json blocks: ${embedded.length}`);

  const { scripts, candidates } = extractApiCandidates(page.body, url.toString(), allowHost);
  console.log(`3) bundles (${scripts.length}):`);
  for (const script of scripts) console.log(`   · ${script}`);
  console.log(`   api-looking literals (${candidates.length}):`);
  for (const candidate of candidates.slice(0, 10)) console.log(`   · ${candidate.url}`);

  const negotiated = await get(url.toString(), "application/json, text/plain, */*");
  if (negotiated) {
    const isJson = /^\s*[{[]/.test(negotiated.body);
    console.log(
      `4) same-url json  status=${negotiated.status} bytes=${negotiated.body.length} contentType=${
        negotiated.contentType || "-"
      } ${isJson ? "(JSON!)" : "(not JSON)"}`,
    );
  }

  // Full discovery pass: fixtures-free, one page + a few allowlisted follow-ups.
  const http = {
    request: async ({ url: href, headers }: { url: string; headers?: Record<string, string> }) => {
      const response = await get(href, headers?.accept ?? "application/json, text/plain, */*");
      if (!response) throw new Error("network");
      if (response.status >= 400) throw new Error(`http-${response.status}`);
      return { status: response.status, body: response.body, headers: {}, latencyMs: response.ms, retries: 0, url: href, fromCache: false };
    },
    isAllowedHost: (candidate: URL) => candidate.host === url.host,
  } as never;

  const discovery = await discoverOffersEndpoint({
    http,
    html: page.body,
    pageUrl: url.toString(),
    allowHost,
    deadline: Date.now() + 20_000,
  });

  console.log(`5) discovery  items=${discovery.items.length} endpoint=${discovery.endpoint ?? "-"}`);
  if (discovery.report.shapes.length > 0) {
    for (const shape of discovery.report.shapes.slice(0, 5)) {
      console.log(`   · ${shape.endpoint}`);
      console.log(`     top-level keys: ${shape.topLevelKeys.join(", ") || "-"}`);
      console.log(`     item keys:      ${shape.itemKeys.join(", ") || "-"}`);
    }
  }

  if (save) {
    const dir = path.resolve(".provider-snapshots");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${url.host}.html`);
    writeFileSync(file, page.body, "utf8");
    console.log(`\nraw body → ${file} (git-ignored; contains the source's own markup)`);
  }

  console.log(
    `\nverdict: ${
      discovery.items.length > 0
        ? "offers are readable — an adapter can map this"
        : priceish > 3 && clocks > 3
          ? "prices are in the HTML — an HTML parser can map this"
          : "JS-only from this network; run this from a machine that sees the full page"
    }`,
  );
  if (discovery.items.length === 0) process.exitCode = 1;
}

void main();
