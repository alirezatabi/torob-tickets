import { CrawlHttpClient } from "../src/crawler/http";
import { CRAWL_SOURCES } from "../src/crawler/sources";

if (process.env.CRAWLER_ENABLED !== "1") throw new Error("Set CRAWLER_ENABLED=1 to explicitly enable a local network probe.");
const client = new CrawlHttpClient();
const lines = [`# Crawler probe report`, ``, `Run: ${new Date().toISOString()}`, ``, `No live response has been asserted by the repository test suite.`, ``];
for (const source of CRAWL_SOURCES) {
  const url = process.env[`CRAWL_URL_${source.id.toUpperCase()}`];
  if (!url) { lines.push(`- ${source.name} (${source.id}): pending — set CRAWL_URL_${source.id.toUpperCase()} to a known public search URL; no endpoint is guessed.`); continue; }
  const probeUrl = url.replaceAll("{route}", "THR-MHD").replaceAll("{date}", new Date().toISOString().slice(0, 10));
  try {
    const response = await client.get(probeUrl);
    const body = await response.text();
    const challenge = /captcha|verify you are human|access denied|challenge/i.test(body);
    lines.push(`- ${source.name} (${source.id}): HTTP ${response.status}; ${challenge ? "CHALLENGE_DETECTED" : `received ${body.length} bytes`}. Parser: NOT_IMPLEMENTED pending real fixture.`);
  } catch (error) { lines.push(`- ${source.name} (${source.id}): blocked/failed — ${error instanceof Error ? error.message : "unknown error"}`); }
}
const report = `${lines.join("\n")}\n`;
console.log(report);
if (process.env.CRAWL_PROBE_REPORT === "1") {
  const { appendFile, mkdir } = await import("node:fs/promises");
  await mkdir("docs", { recursive: true });
  await appendFile("docs/CRAWLER.md", `\n\n## Local probe run\n\n${report}`);
}
