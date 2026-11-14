export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type CrawlFailureCode = "ROBOTS_UNAVAILABLE" | "ROBOTS_DISALLOWED" | "CHALLENGE_DETECTED" | "REQUEST_LIMIT" | "HTTP_ERROR" | "NETWORK_ERROR";
export class CrawlError extends Error {
  constructor(public readonly code: CrawlFailureCode, message: string) { super(message); this.name = "CrawlError"; }
}

export interface HttpOptions {
  fetch?: FetchLike;
  userAgent?: string;
  minHostDelayMs?: number;
  maxRequests?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const CHALLENGE = /captcha|verify you are human|are you a robot|access denied|challenge-platform|cloudflare ray id|login required/i;

/** Polite, fail-closed HTTP client; queues are serialized per host, including robots.txt. */
export class CrawlHttpClient {
  private readonly fetcher: FetchLike;
  private readonly delay: number;
  private readonly limit: number;
  private readonly attempts: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly clock: () => number;
  private readonly ua: string;
  private used = 0;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly lastRequest = new Map<string, number>();
  private readonly robots = new Map<string, Promise<string>>();

  constructor(options: HttpOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.delay = Math.max(3000, options.minHostDelayMs ?? 3000);
    this.limit = options.maxRequests ?? 40;
    this.attempts = Math.min(3, Math.max(1, options.maxAttempts ?? 3));
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.sleep = options.sleep ?? defaultSleep;
    this.clock = options.now ?? Date.now;
    this.ua = options.userAgent ?? "TorobTicketsResearchBot/1.0 (+https://github.com/alirezatabi/torob-tickets; contact project maintainer)";
  }

  async get(url: string): Promise<Response> {
    const target = new URL(url);
    await this.assertAllowed(target);
    return this.request(target);
  }

  private async assertAllowed(target: URL): Promise<void> {
    const origin = target.origin;
    let pending = this.robots.get(origin);
    if (!pending) {
      pending = this.enqueue(target.host, async () => {
        let response: Response;
        try { response = await this.rawFetch(new URL("/robots.txt", origin)); }
        catch { throw new CrawlError("ROBOTS_UNAVAILABLE", `Could not fetch robots.txt for ${origin}`); }
        if (!response.ok) throw new CrawlError("ROBOTS_UNAVAILABLE", `robots.txt returned HTTP ${response.status}`);
        return response.text();
      });
      this.robots.set(origin, pending);
    }
    let text: string;
    try { text = await pending; } catch (error) { this.robots.delete(origin); throw error; }
    if (!robotsAllows(text, target.pathname, this.ua)) throw new CrawlError("ROBOTS_DISALLOWED", `robots.txt disallows ${target.pathname}`);
  }

  private enqueue<T>(host: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(host) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.queues.set(host, current);
    return current.finally(() => { if (this.queues.get(host) === current) this.queues.delete(host); });
  }

  /** Each redirect is manually inspected and robots-checked before following it. */
  private async request(initial: URL): Promise<Response> {
    let url = initial;
    for (let redirect = 0; redirect <= 5; redirect += 1) {
      const response = await this.enqueue(url.host, () => this.requestHop(url));
      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers.get("location");
      if (!location || redirect === 5) throw new CrawlError("HTTP_ERROR", `Unusable or excessive redirect from ${url.origin}${url.pathname}`);
      const next = new URL(location, url);
      if (next.protocol !== "https:" && next.protocol !== "http:") throw new CrawlError("HTTP_ERROR", "Redirect used an unsupported scheme");
      await this.assertAllowed(next);
      url = next;
    }
    throw new CrawlError("HTTP_ERROR", "Redirect limit exceeded");
  }

  private async requestHop(url: URL): Promise<Response> {
    for (let attempt = 0; attempt < this.attempts; attempt += 1) {
      let response: Response;
      try { response = await this.rawFetch(url); }
      catch (error) {
        if (error instanceof CrawlError) throw error;
        if (attempt + 1 < this.attempts) { await this.sleep(1000 * 2 ** attempt); continue; }
        throw new CrawlError("NETWORK_ERROR", `Request failed for ${url.origin}${url.pathname}${error instanceof Error ? `: ${error.name}` : ""}`);
      }
      const body = await response.clone().text();
      if (CHALLENGE.test(body) || response.status === 403 || (response.status === 429 && /captcha|challenge/i.test(response.headers.get("content-type") ?? ""))) {
        throw new CrawlError("CHALLENGE_DETECTED", `Challenge or access block at ${url.origin}; no retry attempted`);
      }
      if (response.status >= 300 && response.status < 400) return response;
      if (response.ok) return response;
      if ((response.status === 429 || response.status >= 500) && attempt + 1 < this.attempts) {
        await this.sleep(parseRetryAfter(response.headers.get("retry-after"), this.clock()) ?? 1000 * 2 ** attempt);
        continue;
      }
      throw new CrawlError("HTTP_ERROR", `HTTP ${response.status} for ${url.origin}${url.pathname}`);
    }
    throw new CrawlError("NETWORK_ERROR", `Request failed for ${url.origin}${url.pathname}`);
  }

  private async rawFetch(url: URL): Promise<Response> {
    if (this.used >= this.limit) throw new CrawlError("REQUEST_LIMIT", `Request ceiling (${this.limit}) reached`);
    const previous = this.lastRequest.get(url.host);
    if (previous !== undefined) {
      const wait = this.delay - (this.clock() - previous);
      if (wait > 0) await this.sleep(wait);
    }
    this.used += 1;
    this.lastRequest.set(url.host, this.clock());
    return this.fetcher(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(this.timeoutMs), headers: { "user-agent": this.ua, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" } });
  }
}

function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : null;
}

function robotsAllows(text: string, pathname: string, userAgent: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let group: { agents: string[]; rules: { allow: boolean; path: string }[] } | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#", 1)[0]?.trim();
    if (!line) continue;
    const colon = line.indexOf(":"); if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase(); const value = line.slice(colon + 1).trim();
    if (key === "user-agent") { if (!group || group.rules.length) { group = { agents: [], rules: [] }; groups.push(group); } group.agents.push(value.toLowerCase()); }
    else if ((key === "allow" || key === "disallow") && group && value) group.rules.push({ allow: key === "allow", path: value });
  }
  const token = userAgent.split(/[ /]/)[0]?.toLowerCase() ?? "";
  const relevant = groups.filter((item) => item.agents.some((agent) => agent === "*" || token.includes(agent)));
  const specific = relevant.some((item) => item.agents.some((agent) => agent !== "*"));
  const rules = relevant.filter((item) => !specific || item.agents.some((agent) => agent !== "*")).flatMap((item) => item.rules);
  const matches = rules.filter((rule) => pathname.startsWith(rule.path)).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return matches.length === 0 || matches[0]!.allow;
}
