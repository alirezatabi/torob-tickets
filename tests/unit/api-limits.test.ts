import { describe, expect, it, beforeEach } from "vitest";
import { clientKey, rateLimit, rateLimitBucketCount, resetRateLimits } from "@/modules/api/rate-limit";
import { POST as intentPost } from "@/app/api/intent/route";

/**
 * B23: the two LLM-backed endpoints accept a bounded input and are rate limited.
 */

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/intent", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => resetRateLimits());

describe("rate limiter", () => {
  it("allows the budget then refuses with a retry hint", () => {
    const options = { windowMs: 60_000, limit: 2 };
    const start = new Date("2026-11-20T10:00:00Z");
    expect(rateLimit("1.2.3.4", options, start).ok).toBe(true);
    expect(rateLimit("1.2.3.4", options, start).ok).toBe(true);
    const blocked = rateLimit("1.2.3.4", options, start);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("opens a fresh window after it expires", () => {
    const options = { windowMs: 1_000, limit: 1 };
    const start = new Date("2026-11-20T10:00:00Z");
    expect(rateLimit("k", options, start).ok).toBe(true);
    expect(rateLimit("k", options, start).ok).toBe(false);
    expect(rateLimit("k", options, new Date(start.getTime() + 1_001)).ok).toBe(true);
  });

  it("keeps its in-memory bucket count bounded under unique keys", () => {
    const now = new Date("2026-11-20T10:00:00Z");
    const options = { windowMs: 60_000, limit: 1 };
    for (let index = 0; index < 10_250; index++) {
      rateLimit(`client-${index}`, options, now);
    }
    expect(rateLimitBucketCount()).toBeLessThanOrEqual(10_000);
  });

  it("uses forwarded client addresses only when a trusted proxy is explicitly enabled", () => {
    const previous = process.env.TRUST_PROXY;
    try {
      process.env.TRUST_PROXY = "0";
      expect(clientKey(request({}, { "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("anonymous");
      process.env.TRUST_PROXY = "1";
      expect(clientKey(request({}, { "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("10.0.0.1");
      expect(clientKey(request({}))).toBe("anonymous");
    } finally {
      if (previous === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = previous;
    }
  });
});

describe("/api/intent", () => {
  it("rejects a too-short request with a Persian message", async () => {
    const response = await intentPost(request({ text: "a" }));
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("کوتاه");
  });

  it("rejects an over-long request instead of spending a model call", async () => {
    const response = await intentPost(request({ text: "ا".repeat(401) }));
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("بلند");
  });

  it("rejects a non-JSON body", async () => {
    const response = await intentPost(
      new Request("http://localhost/api/intent", { method: "POST", body: "not json", headers: { "content-type": "text/plain" } }),
    );
    expect(response.status).toBe(400);
  });

  it("answers a valid sentence with structured intent and no API key", async () => {
    const response = await intentPost(request({ text: "پرواز اصفهان به کیش فردا برای ۲ نفر" }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { intent: { originCode: string | null }; source: string };
    expect(body.intent.originCode).toBe("IFN");
    expect(body.source).toBe("parser");
  });

  it("returns 429 once the window is exhausted", async () => {
    const headers = { "x-forwarded-for": "5.5.5.5" };
    let last: Response | null = null;
    for (let index = 0; index < 25; index++) {
      last = await intentPost(request({ text: "پرواز تهران به مشهد" }, headers));
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get("retry-after")).toBeTruthy();
  });
});
