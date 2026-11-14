import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CrawlHttpClient } from "../src/crawler/http";
import { isCrawlSourceId } from "../src/crawler/sources";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (key: string) => { const index = args.indexOf(key); return index < 0 ? undefined : args[index + 1]; };
  const sourceId = value("--source"); const route = value("--route"); const date = value("--date");
  const responseFile = value("--response-file");
  if (!sourceId || !isCrawlSourceId(sourceId) || !route || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw new Error("Usage: npm run crawl:capture -- --source <id> --route THR-MHD --date YYYY-MM-DD [--response-file <saved-response.json>]");
  const validDate = date!;
  let body: string;
  let status = "local-response-file";
  if (responseFile) {
    // Offline import: useful for DevTools-captured POST responses without guessing/replaying
    // the site's request body. No network access and no CRAWLER_ENABLED opt-in is needed.
    body = sanitize(await readFile(resolve(responseFile), "utf8"));
  } else {
    if (process.env.CRAWLER_ENABLED !== "1") throw new Error("Set CRAWLER_ENABLED=1 to explicitly enable this local network capture.");
    const template = process.env[`CRAWL_URL_${sourceId.toUpperCase()}`];
    if (!template) throw new Error(`Set CRAWL_URL_${sourceId.toUpperCase()} to a known public URL; no URL pattern or POST body is guessed.`);
    const url = template.replaceAll("{route}", encodeURIComponent(route)).replaceAll("{date}", encodeURIComponent(validDate));
    const response = await new CrawlHttpClient().get(url);
    status = `HTTP-${response.status}`;
    body = sanitize(await response.text());
  }
  const isJson = isJsonText(body);
  const dir = resolve("tests/fixtures/crawl", sourceId); await mkdir(dir, { recursive: true });
  const file = resolve(dir, `${route.toLowerCase()}-${validDate}.${isJson ? "json" : "html"}`);
  const metadata = `<!-- Capture metadata: source=${sourceId}; route=${route}; date=${validDate}; capturedAt=${new Date().toISOString()}; status=${status}; URL and request headers omitted -->\n`;
  await writeFile(file, `${isJson ? "" : metadata}${body}\n`, { mode: 0o600 });
  console.log(`Saved sanitized response fixture: ${file} (${body.length} chars). Review manually before committing.`);
}

function sanitize(input: string): string {
  try {
    const parsed: unknown = JSON.parse(input);
    return `${JSON.stringify(redactJson(parsed), null, 2)}\n`;
  } catch {
    return input
      .replace(/<input\b([^>]*\btype\s*=\s*["']?hidden["']?[^>]*)>/gi, (tag) => tag.replace(/\bvalue\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "value=\"[REDACTED]\""))
      .replace(/((?:csrf|xsrf|token|session|auth|secret|cookie)[\w.-]*\s*["']?\s*[:=]\s*["']?)[^\s"'&,;}<]+/gi, "$1[REDACTED]")
      .replace(/(set-cookie\s*:\s*)[^\r\n<]+/gi, "$1[REDACTED]")
      .replace(/[?&](?:token|access_token|auth|session|key)=[^&#\s"']+/gi, "?[REDACTED]");
  }
}
function redactJson(value: unknown, key = ""): unknown {
  if (/^(?:authorization|cookie|set-cookie|csrf|xsrf|.*(?:access.?token|auth.?token|session.?token|secret))$/i.test(key)) return "[REDACTED]";
  // Source booking links can contain opaque session/search identifiers; preserve no deep links.
  if (/^(?:url|redirectData)$/i.test(key)) return null;
  if (Array.isArray(value)) return value.map((item) => redactJson(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redactJson(child, childKey)]));
  return value;
}
function isJsonText(value: string): boolean { try { JSON.parse(value); return true; } catch { return false; } }

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
