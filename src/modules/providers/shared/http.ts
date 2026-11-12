/**
 * The only outbound HTTP entry point for provider connectors.
 *
 * It exists so the *rules* live in one auditable place instead of being re-implemented
 * per connector:
 *   • host allowlist — a connector can only talk to its declared hosts;
 *   • robots.txt is consulted for HTML sources before the first request and the
 *     result is cached; a disallowed path aborts with a `prohibited` error;
 *   • one retry, only for retryable errors, with jittered backoff;
 *   • hard timeout via AbortController (no dangling sockets);
 *   • per-host token bucket so a page view can never turn into a crawl;
 *   • response size cap, so a misbehaving source cannot exhaust memory;
 *   • no browser/TLS impersonation, ever.
 */

import { asProviderError, challengeError, httpError, networkError, ProviderError, timeoutError } from "./errors";
import type { Logger } from "./logger";

export interface RobotsPolicy {
  /** Paths disallowed for `User-agent: *`. */
  disallow: string[];
  /** Hosts we may reach, derived from the source's own sitemap/robots. */
  fetchedAt: string;
}

export interface RateLimitConfig {
  /** Requests allowed inside the window. */
  capacity: number;
  /** Window length in ms. */
  windowMs: number;
}

export interface HttpClientConfig {
  /** Hosts this client may call (no wildcards, no redirects off-list). */
  allowedHosts: string[];
  /**
   * Hosts explicitly permitted over plain http. Used only for an operator-supplied local
   * mirror (`SEPEHR360_BASE_URL=http://127.0.0.1:4000`), never for a real source.
   */
  insecureHosts?: string[];
  /** Hosts whose robots.txt must be honoured before requesting (HTML sources). */
  robotsHosts?: string[];
  /** Per-request timeout. */
  timeoutMs?: number;
  rateLimit?: RateLimitConfig;
  /** Max response body in bytes. */
  maxBytes?: number;
  /** User-Agent. Must identify the project and a contact route. */
  userAgent?: string;
  logger: Logger;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

export interface HttpRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** Human label used in logs ("search page"). */
  label?: string;
}

export interface HttpResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
  latencyMs: number;
  retries: number;
  url: string;
  fromCache: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 3_000_000;

/** Minimal robots matcher: our own implementation, no dependency, no surprises. */
export function isPathAllowed(policy: RobotsPolicy, path: string): boolean {
  const target = normalizePath(path);
  for (const rule of policy.disallow) {
    const pattern = normalizePath(rule);
    if (!pattern) continue;
    if (pattern.includes("*")) {
      if (wildcardMatches(pattern, target)) return false;
    } else if (target === pattern || target.startsWith(`${pattern}/`)) {
      return false;
    }
  }
  return true;
}

/** robots wildcard: `*` matches any run of characters; end-of-pattern is anchored. */
function wildcardMatches(pattern: string, target: string): boolean {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}`).test(target);
}

function normalizePath(input: string): string {
  try {
    // Accept either a path or a full URL and always compare path + query.
    const url = input.startsWith("http") ? new URL(input) : null;
    const value = url ? `${url.pathname}${url.search}` : input;
    return value.replace(/\/+$/, "") || "/";
  } catch {
    return input;
  }
}

export class HttpClient {
  private readonly config: Required<Pick<HttpClientConfig, "allowedHosts">> & HttpClientConfig;
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();
  private readonly robots = new Map<string, RobotsPolicy | null>();

  constructor(config: HttpClientConfig) {
    this.config = config as HttpClient["config"];
  }

  /**
   * Run a request. Throws `ProviderError` for every failure mode so callers only ever
   * deal with one error type.
   */
  /** True when a URL is on this connector's allowlist (used by API discovery). */
  isAllowedHost(url: URL): boolean {
    if (!this.config.allowedHosts.includes(url.host)) return false;
    if (url.protocol === "https:") return true;
    // Plain http is only ever the explicit local-mirror escape hatch.
    return url.protocol === "http:" && (this.config.insecureHosts ?? []).includes(url.host);
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    const url = new URL(request.url);
    if (!this.config.allowedHosts.includes(url.host)) {
      throw new ProviderError({
        code: "prohibited",
        summaryFa: "درخواست به میزبان غیرمجاز متوقف شد",
        detail: `host ${url.host} not in allowlist`,
        retryable: false,
      });
    }

    await this.assertRobots(url);
    await this.takeToken(url.host);

    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const fetchImpl = this.config.fetchImpl ?? globalThis.fetch;
    const label = request.label ?? url.pathname;
    let retries = 0;
    let lastError: ProviderError | null = null;

    while (retries <= 1) {
      const startedAt = this.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(request.url, {
          method: request.method ?? "GET",
          headers: {
            accept: "text/html,application/json;q=0.9,*/*;q=0.8",
            "accept-language": "fa-IR,fa;q=0.9,en;q=0.8",
            "user-agent": this.config.userAgent ?? defaultUserAgent(),
            ...request.headers,
          },
          ...(request.body ? { body: request.body } : {}),
          signal: controller.signal,
          redirect: "manual",
          cache: "no-store",
        });

        const body = await this.readBody(response);
        const headers = Object.fromEntries(response.headers.entries());
        const latencyMs = this.now() - startedAt;

        if (response.status >= 300 && response.status < 400) {
          // A redirect is almost always a login wall or a re-route to a different host.
          throw new ProviderError({
            code: "prohibited",
            summaryFa: "منبع درخواست را هدایت (redirect) کرد",
            detail: `redirect ${response.status} → ${headers.location ?? "?"}`,
            httpStatus: response.status,
            retryable: false,
          });
        }

        if (response.status >= 400) {
          throw httpError(response.status, body);
        }

        const challenge = detectChallenge(body);
        if (challenge) throw challengeError(challenge);

        this.config.logger.info("http.ok", {
          label,
          status: response.status,
          ms: latencyMs,
          bytes: body.length,
          retries,
        });

        return {
          status: response.status,
          body,
          headers,
          latencyMs,
          retries,
          url: request.url,
          fromCache: false,
        };
      } catch (error) {
        const providerError = asProviderError(
          error instanceof DOMException && error.name === "AbortError" ? timeoutError(timeoutMs) : error,
        );
        lastError = providerError;

        this.config.logger.warn("http.error", {
          label,
          code: providerError.code,
          status: providerError.httpStatus ?? 0,
          retryable: providerError.retryable,
          retries,
          detail: providerError.detail ?? "",
        });

        if (providerError.code === "timeout" && !controller.signal.aborted) {
          lastError = timeoutError(timeoutMs);
        }

        if (!lastError.retryable || retries === 1) break;
        retries += 1;
        await this.sleep(250 + Math.round(Math.random() * 250));
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? networkError("unknown");
  }

  private async readBody(response: Response): Promise<string> {
    const maxBytes = this.config.maxBytes ?? DEFAULT_MAX_BYTES;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > maxBytes) {
      throw new ProviderError({
        code: "parse",
        summaryFa: "پاسخ منبع بیش از حد بزرگ بود",
        detail: `content-length ${declared} > ${maxBytes}`,
        retryable: false,
      });
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new ProviderError({
        code: "parse",
        summaryFa: "پاسخ منبع بیش از حد بزرگ بود",
        detail: `body ${buffer.byteLength} > ${maxBytes}`,
        retryable: false,
      });
    }
    return new TextDecoder("utf-8").decode(buffer);
  }

  /**
   * robots.txt gate for HTML sources. A source whose robots disallows the requested
   * path is not called at all — we report it as `prohibited` instead.
   */
  private async assertRobots(url: URL): Promise<void> {
    const robotsHosts = this.config.robotsHosts;
    if (!robotsHosts || !robotsHosts.includes(url.host)) return;

    const policy = await this.loadRobots(url.origin);
    if (!policy) return; // robots missing → treat as no restrictions (RFC 9309 allows this)
    if (!isPathAllowed(policy, `${url.pathname}${url.search}`)) {
      throw new ProviderError({
        code: "prohibited",
        summaryFa: "نقشهٔ robots منبع این مسیر را مجاز نمی‌داند",
        detail: `robots disallows ${url.pathname}${url.search}`,
        retryable: false,
      });
    }
  }

  private async loadRobots(origin: string): Promise<RobotsPolicy | null> {
    const cached = this.robots.get(origin);
    if (cached !== undefined) return cached;

    const fetchImpl = this.config.fetchImpl ?? globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetchImpl(`${origin}/robots.txt`, {
        headers: { "user-agent": this.config.userAgent ?? defaultUserAgent() },
        signal: controller.signal,
        redirect: "manual",
        cache: "no-store",
      });
      if (!response.ok) {
        this.robots.set(origin, null);
        return null;
      }
      const text = await response.text();
      const policy = parseRobots(text);
      this.robots.set(origin, policy);
      this.config.logger.info("robots.loaded", { origin, disallowRules: policy.disallow.length });
      return policy;
    } catch {
      // Unreachable robots.txt is not a licence to fetch; but it is also not evidence
      // of a restriction. Record "unknown" and keep the per-source allowlist as the gate.
      this.config.logger.warn("robots.unavailable", { origin });
      this.robots.set(origin, null);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async takeToken(host: string): Promise<void> {
    const config = this.config.rateLimit;
    if (!config) return;
    const now = this.now();
    const bucket = this.buckets.get(host) ?? { tokens: config.capacity, updatedAt: now };
    const refill = ((now - bucket.updatedAt) / config.windowMs) * config.capacity;
    let tokens = Math.min(config.capacity, bucket.tokens + refill);
    while (tokens < 1) {
      const waitMs = Math.ceil(((1 - tokens) * config.windowMs) / config.capacity);
      await this.sleep(Math.min(waitMs, 1_000));
      const after = this.now();
      tokens = Math.min(config.capacity, tokens + ((after - bucket.updatedAt) / config.windowMs) * config.capacity);
      bucket.updatedAt = after;
    }
    bucket.tokens = tokens - 1;
    bucket.updatedAt = now;
    this.buckets.set(host, bucket);
  }

  private now(): number {
    return this.config.now ? this.config.now() : Date.now();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function parseRobots(text: string, userAgent = "*"): RobotsPolicy {
  const disallow: string[] = [];
  let applies = false;
  let sawGroup = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (!key || !value && key !== "disallow") continue;

    if (key === "user-agent") {
      applies = value === userAgent || value === "*";
      if (applies) sawGroup = true;
      continue;
    }
    if (!applies || !sawGroup) continue;
    if (key === "disallow" && value) disallow.push(value);
  }

  return { disallow, fetchedAt: new Date().toISOString() };
}

/** Challenges that look like a successful response but are an access wall. */
function detectChallenge(body: string): string | null {
  const lower = body.slice(0, 4_000).toLowerCase();
  if (lower.includes("g-recaptcha") || lower.includes("hcaptcha") || lower.includes("cf-challenge")) {
    return "captcha";
  }
  if (lower.includes("just a moment") && lower.includes("cloudflare")) return "cloudflare";
  if (lower.includes("برای ادامه، وارد حساب")) return "login-wall";
  return null;
}

function defaultUserAgent(): string {
  return "TorobTicketsBot/1.0 (+https://github.com/alirezatabi/torob-tickets; demo aggregator; contact via repo)";
}
