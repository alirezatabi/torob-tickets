/**
 * A tiny fixed-window rate limiter for the LLM-backed routes (B23).
 *
 * Why it exists: `/api/intent` and `/api/explain` can spend money (one model call each).
 * Without any limit, a loop of curl requests is an open tap. The limiter is deliberately
 * in-process — the project is a modular monolith and the constraint list forbids Redis —
 * and it is honest about what that means: on a multi-instance/serverless deployment each
 * instance keeps its own window (documented in the README, see B21).
 */

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** How many requests one client may make per window. */
  limit: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the current window resets (0 when allowed). */
  retryAfterSeconds: number;
  remaining: number;
}

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

/** Test hook: forget every window (never called from application code). */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Identify the caller. Behind a proxy the first `x-forwarded-for` hop is the client; without
 * one we fall back to a single shared bucket, which is the conservative choice.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return request.headers.get("x-real-ip")?.trim() || "anonymous";
}

export function rateLimit(key: string, options: RateLimitOptions, now: Date = new Date()): RateLimitResult {
  const current = now.getTime();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= current) {
    buckets.set(key, { count: 1, resetAt: current + options.windowMs });
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

/** The two LLM-backed endpoints share these budgets. */
export const INTENT_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, limit: 20 };
export const EXPLAIN_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, limit: 30 };
