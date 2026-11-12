import { describe, expect, it, vi } from "vitest";

import { HttpClient, isPathAllowed, parseRobots } from "@/modules/providers/shared/http";
import { createMemoryLogger } from "@/modules/providers/shared/logger";
import { ProviderError } from "@/modules/providers/shared/errors";

function jsonResponse(body: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers: { "content-type": "text/html", ...headers } });
}

/** A fetch stub routed by URL substring; records every call. */
function stubFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    for (const [needle, responder] of Object.entries(routes)) {
      if (url.includes(needle)) return responder(init);
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function client(overrides: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) {
  return new HttpClient({
    allowedHosts: ["example.com"],
    logger: createMemoryLogger(),
    timeoutMs: 1_000,
    fetchImpl: stubFetch({}).impl,
    ...overrides,
  });
}

describe("robots.txt parsing", () => {
  it("collects disallow rules for * only", () => {
    const policy = parseRobots(`
      User-agent: Googlebot
      Disallow: /private

      User-agent: *
      Disallow: /systemuser
      Disallow: /controlpanel
      Allow: /
    `);
    expect(policy.disallow).toEqual(["/systemuser", "/controlpanel"]);
  });

  it("matches path prefixes, not substrings", () => {
    const policy = parseRobots("User-agent: *\nDisallow: /systemuser");
    expect(isPathAllowed(policy, "/systemuser/list")).toBe(false);
    expect(isPathAllowed(policy, "/Flight/B2c/Search")).toBe(true);
    expect(isPathAllowed(policy, "/systemuserx")).toBe(true);
  });

  it("supports wildcard rules", () => {
    const policy = parseRobots("User-agent: *\nDisallow: /*/search?*");
    expect(isPathAllowed(policy, "/en/search?origin=THR")).toBe(false);
    expect(isPathAllowed(policy, "/en/flights")).toBe(true);
  });
});

describe("HttpClient", () => {
  it("refuses hosts outside the allowlist without calling fetch", async () => {
    const { impl, calls } = stubFetch({});
    const http = client({ fetchImpl: impl });

    await expect(http.request({ url: "https://evil.example.org/x" })).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toEqual([]);
  });

  it("honours robots.txt for HTML sources", async () => {
    const { impl, calls } = stubFetch({
      "/robots.txt": () => jsonResponse("User-agent: *\nDisallow: /Flight"),
      "/Flight": () => jsonResponse("<html>should not be reached</html>"),
    });
    const http = client({ fetchImpl: impl, robotsHosts: ["example.com"] });

    await expect(http.request({ url: "https://example.com/Flight/B2c/Search" })).rejects.toMatchObject({
      code: "prohibited",
      retryable: false,
    });
    expect(calls.some((url) => url.includes("/Flight"))).toBe(false);
  });

  it("never retries an access-denied response", async () => {
    const { impl, calls } = stubFetch({ "/search": () => jsonResponse("denied", 403) });
    const http = client({ fetchImpl: impl });

    await expect(http.request({ url: "https://example.com/search" })).rejects.toMatchObject({
      code: "prohibited",
      retryable: false,
    });
    expect(calls).toHaveLength(1);
  });

  it("treats a 200 CAPTCHA page as prohibited, not as data", async () => {
    const { impl } = stubFetch({
      "/search": () => jsonResponse('<html><body><div class="g-recaptcha"></div></body></html>'),
    });
    const http = client({ fetchImpl: impl });

    await expect(http.request({ url: "https://example.com/search" })).rejects.toMatchObject({
      code: "prohibited",
      retryable: false,
    });
  });

  it("retries a 5xx exactly once, then succeeds", async () => {
    let attempt = 0;
    const { impl } = stubFetch({
      "/search": () => {
        attempt += 1;
        return attempt === 1 ? jsonResponse("boom", 503) : jsonResponse("<html>ok</html>");
      },
    });
    const http = client({ fetchImpl: impl });

    const response = await http.request({ url: "https://example.com/search" });
    expect(response.status).toBe(200);
    expect(response.retries).toBe(1);
    expect(attempt).toBe(2);
  });

  it("gives up after one retry on repeated 5xx", async () => {
    const { impl, calls } = stubFetch({ "/search": () => jsonResponse("boom", 502) });
    const http = client({ fetchImpl: impl });

    await expect(http.request({ url: "https://example.com/search" })).rejects.toMatchObject({ code: "http-5xx" });
    expect(calls).toHaveLength(2);
  });

  it("aborts on timeout and reports it as retryable", async () => {
    const impl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    ) as unknown as typeof fetch;

    const http = client({ fetchImpl: impl, timeoutMs: 5 });
    await expect(http.request({ url: "https://example.com/slow" })).rejects.toMatchObject({ code: "timeout" });
  });

  it("refuses to follow redirects (login walls) and reports them", async () => {
    const { impl } = stubFetch({
      "/search": () => new Response("", { status: 302, headers: { location: "/login" } }),
    });
    const http = client({ fetchImpl: impl });

    await expect(http.request({ url: "https://example.com/search" })).rejects.toMatchObject({
      code: "prohibited",
      retryable: false,
    });
  });

  it("caps oversized bodies", async () => {
    const { impl } = stubFetch({ "/search": () => jsonResponse("x".repeat(5_000)) });
    const http = client({ fetchImpl: impl, maxBytes: 1_000 });

    await expect(http.request({ url: "https://example.com/search" })).rejects.toBeInstanceOf(ProviderError);
  });

  it("does not retry 4xx caused by our own request", async () => {
    const { impl, calls } = stubFetch({ "/search": () => jsonResponse("bad request", 400) });
    const http = client({ fetchImpl: impl });

    await expect(http.request({ url: "https://example.com/search" })).rejects.toMatchObject({
      code: "http-4xx",
      retryable: false,
    });
    expect(calls).toHaveLength(1);
  });
});
