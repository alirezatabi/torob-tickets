/**
 * API auto-discovery for JavaScript-rendered sources.
 *
 * The problem this solves, concretely: Sepehr360's search page returns HTTP 200 with a
 * 5 KB shell whose body contains **no price and no clock time** (`clues:price=0 clock=0`).
 * Publicly it is an HTML page; in practice the offers arrive from a JSON endpoint called by
 * the site's own bundle. No amount of HTML-parser tuning can read that, and hard-coding a
 * guessed endpoint would be fabrication.
 *
 * So we do what a browser does, minus the browser:
 *   1. read the page, list its `<script src>` bundles and inline scripts;
 *   2. pull out string literals that look like API paths (`/api/…`, `…/search`, `…/Flight`)
 *      on an allowlisted host;
 *   3. `GET` the most promising few (bounded: 2 bundles + 4 probes, once per process);
 *   4. accept a response as "the offers endpoint" only when it is JSON containing an array
 *      of objects that also carry a price-ish and two time-ish fields.
 *
 * Everything here is intentionally conservative: bounded request count, allowlisted hosts,
 * robots respected by the shared `HttpClient`, and no attempt to defeat a challenge. When
 * discovery fails it returns a *report* — which endpoint shapes were seen, and what the
 * JSON looked like — so the next step is evidence, not a guess.
 */

import type { HttpClient } from "./http";

export interface ApiCandidate {
  /** Absolute URL, already resolved against the page. */
  url: string;
  /** Bundle or page the literal came from (for the report). */
  source: string;
}

export interface DiscoveryReport {
  /** Bundles/scripts that were inspected. */
  scripts: string[];
  /** Endpoints that answered with JSON. */
  jsonEndpoints: string[];
  /** Endpoint that looks like the offers feed, when one was recognised. */
  matches: string[];
  /** Recorded JSON shapes for the report: `{endpoint, topLevelKeys, itemKeys}`. */
  shapes: Array<{ endpoint: string; topLevelKeys: string[]; itemKeys: string[] }>;
}

export interface DiscoveryResult {
  /** Raw flight-ish objects, one per offer, from the best endpoint. */
  items: Record<string, unknown>[];
  /** Endpoint the items came from. */
  endpoint: string | null;
  report: DiscoveryReport;
}

const MAX_SCRIPTS = 2;
const MAX_PROBES = 3;
const MAX_BYTES = 400_000;

/** Keys that must exist on a "flight offer" object for us to accept the endpoint. */
const PRICE_KEY = /(price|fare|amount|total|cost|قیمت)/i;
const DEPART_KEY = /(depart|takeoff|take_off|origin.*time|time.*origin|خروج)/i;
const ARRIVE_KEY = /(arriv|landing|land|destination.*time|ورود)/i;

/**
 * Pull API-looking string literals out of a chunk of JavaScript.
 *
 * Exported separately because the interesting text is usually a *bundle*, not the page: the
 * page loads `/assets/app.<hash>.js`, and the bundle is where the endpoint is named. Only
 * quoted literals on an allowlisted https host whose path looks like an API are kept.
 */
export function scanText(
  text: string,
  pageUrl: string,
  allowHost: (url: URL) => boolean,
  source: string,
  seen: Set<string> = new Set<string>(),
  candidates: ApiCandidate[] = [],
): ApiCandidate[] {
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return candidates;
  }

  const push = (raw: string) => {
    let url: URL;
    try {
      url = new URL(raw, page);
    } catch {
      return;
    }
    if (url.protocol !== "https:" || !allowHost(url)) return;
    if (!/\/(api|ws|v\d|flight|search)/i.test(url.pathname)) return;
    const key = url.toString();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ url: key, source });
  };

  // Quoted literals only: a URL is a string in JS, and this keeps false positives low.
  for (const match of text.matchAll(/["'`]([/a-zA-Z0-9._~:?&=%-]{8,160})["'`]/g)) {
    const literal = match[1];
    if (!literal) continue;
    push(literal);
    // Bundles often write `"api/flight/search"` and concatenate the base at runtime; resolved
    // as-is that would land under the current path, so also try it as an absolute path.
    if (!literal.startsWith("/") && !literal.startsWith("http")) push(`/${literal}`);
  }

  return candidates;
}

export function extractApiCandidates(
  html: string,
  pageUrl: string,
  allowHost: (url: URL) => boolean,
): { candidates: ApiCandidate[]; scripts: string[] } {
  const page = new URL(pageUrl);
  const sources: Array<{ text: string; origin: string }> = [];

  // Inline scripts first — single-page apps often inline their config.
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]{0,20000}?)<\/script>/gi)) {
    sources.push({ text: match[1] ?? "", origin: pageUrl });
  }

  const scripts = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter((src): src is string => Boolean(src))
    .map((src) => {
      try {
        return new URL(src, page).toString();
      } catch {
        return null;
      }
    })
    .filter((url): url is string => Boolean(url) && allowHost(new URL(url as string)))
    .slice(0, MAX_SCRIPTS);

  const candidates: ApiCandidate[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    scanText(source.text, pageUrl, allowHost, source.origin, seen, candidates);
  }

  return { candidates, scripts };
}

// ————————————————————————————————————————————————————————————————
// Shape recognition
// ————————————————————————————————————————————————

/** Every key in an object, flattened one level (covers `{data:{…}}` wrappers). */
function keysOf(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.keys(value as Record<string, unknown>);
}

/**
 * Does this object look like one flight offer?
 * We require a price-ish key plus departure *and* arrival time-ish keys; anything less and
 * we would be guessing which number is which field.
 */
export function looksLikeFlightOffer(item: unknown): boolean {
  const keys = keysOf(item);
  if (keys.length < 3) return false;
  const hasPrice = keys.some((key) => PRICE_KEY.test(key));
  const hasDepart = keys.some((key) => DEPART_KEY.test(key));
  const hasArrive = keys.some((key) => ARRIVE_KEY.test(key));
  return hasPrice && hasDepart && hasArrive;
}

/**
 * Find the most plausible array of offers anywhere in a JSON payload.
 * Deep-walks objects/arrays (depth-capped) and returns the *largest* matching array.
 */
export function findOfferArray(
  payload: unknown,
  depth = 0,
): { path: string; items: Record<string, unknown>[] } | null {
  if (depth > 6) return null;

  if (Array.isArray(payload)) {
    const objects = payload.filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item),
    );
    if (objects.length > 0 && objects.some(looksLikeFlightOffer)) {
      return { path: "", items: objects };
    }
    // Arrays of wrappers (`[{flights:[…]}]`) are common; search each element.
    let best: { path: string; items: Record<string, unknown>[] } | null = null;
    for (const item of payload) {
      const found = findOfferArray(item, depth + 1);
      if (found && (!best || found.items.length > best.items.length)) best = found;
    }
    return best;
  }

  if (payload && typeof payload === "object") {
    let best: { path: string; items: Record<string, unknown>[] } | null = null;
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      const found = findOfferArray(value, depth + 1);
      if (!found) continue;
      const path = found.path ? `${key}.${found.path}` : key;
      if (!best || found.items.length > best.items.length) best = { path, items: found.items };
    }
    return best;
  }

  return null;
}

// ————————————————————————————————————————————————————————————————
// Discovery run
// ————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————
// Embedded JSON
// ————————————————————————————————————————————————————————————————

/**
 * Offers that the server already put *inside* the page.
 *
 * Server-rendered apps often ship the first result set as a JSON blob in the document
 * (`<script type="application/json">`, `window.__INITIAL_STATE__ = {…}`). That is real data
 * from the source, available in one request — always worth reading before probing anything.
 */
export function extractEmbeddedJson(html: string): unknown[] {
  const blobs: unknown[] = [];

  for (const match of html.matchAll(
    /<script[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]{2,400000}?)<\/script>/gi,
  )) {
    const text = match[1]?.trim();
    if (!text) continue;
    try {
      blobs.push(JSON.parse(text));
    } catch {
      // A truncated or templated blob is not evidence of anything; skip it.
    }
  }

  // `window.X = {...}` / `var X = [...]` state assignments.
  for (const match of html.matchAll(
    /(?:window\.|var |let |const )([A-Za-z_$][\w$]*)\s*=\s*(\{[\s\S]{20,400000}?\}|\[[\s\S]{20,400000}?\])\s*;\s*(?:<\/script>|window\.)/g,
  )) {
    const text = match[2];
    if (!text) continue;
    try {
      blobs.push(JSON.parse(text));
    } catch {
      // JavaScript object literals (unquoted keys, functions) will not parse; that is fine.
    }
  }

  return blobs;
}


export interface DiscoveryOptions {
  http: HttpClient;
  /** Page HTML we already fetched (its script tags are the roadmap). */
  html: string;
  pageUrl: string;
  allowHost: (url: URL) => boolean;
  /** Injectable for tests; defaults to `fetch` via the shared HTTP client. */
  maxProbes?: number;
  /**
   * Absolute deadline (epoch ms). Probing stops when it passes, keeping whatever the report
   * has learned so far — a slow source must produce evidence, not a hung request.
   */
  deadline?: number;
}

/**
 * The same question the search page carries, as a JSON body.
 *
 * Foreign field names cannot be guessed, but the *search parameters* can be read from the
 * page URL, and a fares API needs exactly those. Sending them under their own names (plus a
 * couple of common aliases) is a faithful restatement of the request, not an invention.
 */
export function searchBody(pageUrl: string): Record<string, unknown> {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return {};
  }
  const params = url.searchParams;
  const body: Record<string, unknown> = {};
  for (const [key, value] of params.entries()) {
    if (!value || value.length > 120) continue;
    body[key] = value;
  }
  const origin = params.get("origin") ?? params.get("from") ?? params.get("originCode");
  const destination = params.get("destination") ?? params.get("to") ?? params.get("destinationCode");
  const date = params.get("departureDate") ?? params.get("date") ?? params.get("departDate");
  if (origin) body.origin = origin;
  if (destination) body.destination = destination;
  if (date) body.departureDate = date;
  body.adults = body.adults ?? body.passengers ?? "1";
  delete body.passengers;
  return body;
}

export async function discoverOffersEndpoint(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const { http, html, pageUrl, allowHost } = options;
  const deadline = options.deadline ?? Number.POSITIVE_INFINITY;
  const expired = () => Date.now() >= deadline;
  const { candidates, scripts } = extractApiCandidates(html, pageUrl, allowHost);
  const report: DiscoveryReport = { scripts, jsonEndpoints: [], matches: [], shapes: [] };

  // First: what the page already handed us. No extra request, no guessing.
  for (const blob of extractEmbeddedJson(html)) {
    const found = findOfferArray(blob);
    if (!found || found.items.length === 0) continue;
    report.matches.push(pageUrl);
    report.shapes.push({
      endpoint: `${pageUrl} (embedded json)`,
      topLevelKeys: keysOf(blob).slice(0, 12),
      itemKeys: keysOf(found.items[0]).slice(0, 24),
    });
    return { items: found.items, endpoint: pageUrl, report };
  }

  // Pull literals out of the bundles too — the page alone rarely names the endpoint.
  const fromBundles: ApiCandidate[] = [];
  for (const scriptUrl of scripts) {
    if (expired()) break;
    try {
      const bundle = await http.request({ url: scriptUrl, label: `bundle ${new URL(scriptUrl).pathname}` });
      // A bundle is raw JavaScript, not HTML: scan it directly.
      fromBundles.push(...scanText(bundle.body, pageUrl, allowHost, scriptUrl));
    } catch {
      // A bundle that will not load is a dead end, not a failure: the report still says so.
    }
  }

  const probes = [...candidates, ...fromBundles]
    .filter((candidate, index, all) => all.findIndex((other) => other.url === candidate.url) === index)
    .slice(0, options.maxProbes ?? MAX_PROBES);

  // A fares endpoint is useless without the question: route, date, passengers. Single-page
  // apps usually call their own API with the *same* query names the page URL carries, so the
  // page's query string is the honest first probe. The bare URL is the second, for endpoints
  // that already encoded the search server-side.
  let pageQuery = "";
  try {
    pageQuery = new URL(pageUrl).search.replace(/^\?/, "");
  } catch {
    pageQuery = "";
  }

  let best: { endpoint: string; items: Record<string, unknown>[] } | null = null;

  const withQuery = (endpoint: string): string => {
    if (!pageQuery) return endpoint;
    return `${endpoint}${endpoint.includes("?") ? "&" : "?"}${pageQuery}`;
  };

  for (const probe of probes) {
    if (expired()) break;
    // The endpoint called *with* the search is tried first: that is what a browser does.
    // The bare URL is only a fallback, for endpoints that have the search baked in.
    const attempts = pageQuery && !probe.url.includes("?") ? [withQuery(probe.url), probe.url] : [probe.url];

    for (const url of attempts) {
      if (expired()) break;
      let payload: unknown;
      try {
        const response = await http.request({ url, label: `probe ${new URL(url).pathname}` });
        payload = JSON.parse(response.body.slice(0, MAX_BYTES));
      } catch {
        // 404 / robots / prohibited / not-JSON: fall through to the bare variant (if any)
        // and then to the next candidate. Never retry a block.
        continue;
      }

      if (!report.jsonEndpoints.includes(url)) report.jsonEndpoints.push(url);
      const found = findOfferArray(payload);
      report.shapes.push({
        endpoint: url,
        topLevelKeys: keysOf(payload).slice(0, 12),
        itemKeys: found?.items[0] ? keysOf(found.items[0]).slice(0, 24) : [],
      });

      if (found && found.items.length > 0) {
        if (!best || found.items.length > best.items.length) best = { endpoint: url, items: found.items };
        break; // This candidate answered with offers; its bare variant adds nothing.
      }
    }
  }

  // Nothing answered a GET with JSON. The most common reason is a POST-only search API, so
  // try *one* candidate — the most likely one — with the search as a JSON body. Bounded to a
  // single request, allowlisted, no credentials.
  if (!best && probes.length > 0 && !expired() && report.jsonEndpoints.length === 0) {
    const candidate = probes[0];
    if (candidate) {
      const body = JSON.stringify(searchBody(pageUrl));
      try {
        const response = await http.request({
          url: candidate.url,
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body,
          label: `probe post ${new URL(candidate.url).pathname}`,
        });
        const payload = JSON.parse(response.body.slice(0, MAX_BYTES));
        const found = findOfferArray(payload);
        report.jsonEndpoints.push(candidate.url);
        report.shapes.push({
          endpoint: `${candidate.url} (POST)`,
          topLevelKeys: keysOf(payload).slice(0, 12),
          itemKeys: found?.items[0] ? keysOf(found.items[0]).slice(0, 24) : [],
        });
        if (found && found.items.length > 0) best = { endpoint: candidate.url, items: found.items };
      } catch {
        // A refused POST settles the question for this run; report what we have.
      }
    }
  }

  if (best) report.matches.push(best.endpoint);

  return { items: best?.items ?? [], endpoint: best?.endpoint ?? null, report };
}
