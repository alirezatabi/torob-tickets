import { isIP } from "node:net";

/** In-process fixed-window limiter. In multi-instance deployments each process has its own budget. */
export interface RateLimitOptions {
  windowMs: number;
  limit: number;
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

interface Window {
  count: number;
  resetAt: number;
}

export const RATE_LIMIT_BUCKET_CAP = 10_000;
const CLEANUP_EVERY = 64;
const MAX_KEY_LENGTH = 256;
const buckets = new Map<string, Window>();
let callsSinceCleanup = 0;

/** Test hook: forget every window (never called from application code). */
export function resetRateLimits(): void {
  buckets.clear();
  callsSinceCleanup = 0;
}

/** Test hook for asserting the memory cap. */
export function rateLimitBucketCount(): number {
  return buckets.size;
}

/**
 * Do not trust forwarding headers from arbitrary clients. Set TRUST_PROXY=1 only when a
 * controlled reverse proxy overwrites X-Real-IP or appends its client address to X-Forwarded-For.
 * Without that deployment opt-in, all direct requests share one conservative bucket.
 */
export function clientKey(request: Request): string {
  if (process.env.TRUST_PROXY !== "1") return "anonymous";

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp && isIP(realIp)) return realIp;

  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const trustedLastHop = forwarded.split(",").map((part) => part.trim()).filter((part) => isIP(part)).at(-1);
  return trustedLastHop ?? "anonymous";
}

export function rateLimit(key: string, options: RateLimitOptions, now: Date = new Date()): RateLimitResult {
  const current = now.getTime();
  const safeKey = key.slice(0, MAX_KEY_LENGTH) || "anonymous";
  callsSinceCleanup += 1;
  if (callsSinceCleanup >= CLEANUP_EVERY) {
    pruneExpired(current);
    callsSinceCleanup = 0;
  }

  const existing = buckets.get(safeKey);
  if (!existing || existing.resetAt <= current) {
    if (buckets.size >= RATE_LIMIT_BUCKET_CAP) {
      pruneExpired(current);
      if (buckets.size >= RATE_LIMIT_BUCKET_CAP) {
        const oldest = buckets.keys().next().value as string | undefined;
        if (oldest) buckets.delete(oldest);
      }
    }
    buckets.set(safeKey, { count: 1, resetAt: current + options.windowMs });
    return { ok: true, retryAfterSeconds: 0, remaining: options.limit - 1 };
  }

  if (existing.count >= options.limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - current) / 1000)),
      remaining: 0,
    };
  }

  existing.count += 1;
  return { ok: true, retryAfterSeconds: 0, remaining: options.limit - existing.count };
}

function pruneExpired(now: number): void {
  for (const [key, window] of buckets) {
    if (window.resetAt <= now) buckets.delete(key);
  }
}

export const INTENT_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, limit: 20 };
export const EXPLAIN_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, limit: 30 };
export const SEARCH_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, limit: 60 };
export const CRAWL_STATUS_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, limit: 60 };
export const HEALTH_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, limit: 120 };
export const HISTORY_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, limit: 60 };
