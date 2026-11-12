import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/go/sepehr360/route";

/**
 * The redirect hop is the only place that decides where a "دیدن در منبع" click lands, so
 * these tests assert both halves of the contract: a valid offer reaches the provider's
 * search page for the **same route and date**, and anything malformed falls back inside the
 * app instead of bouncing the user somewhere unexpected.
 */

async function call(query: string): Promise<{ status: number; location: string; cache: string | null }> {
  const request = new NextRequest(`http://localhost:3000/api/go/sepehr360?${query}`);
  const response = await GET(request);
  return {
    status: response.status,
    location: response.headers.get("location") ?? "",
    cache: response.headers.get("cache-control"),
  };
}

describe("/api/go/sepehr360", () => {
  it("redirects a live offer to the provider's search page for the same route and date", async () => {
    const { status, location } = await call("origin=THR&destination=MHD&date=2026-11-20&time=04:00&airline=IR");

    expect(status).toBe(302);
    expect(location.startsWith("https://sepehr360.ir/Flight/B2c/Search?")).toBe(true);

    const params = new URL(location).searchParams;
    expect(params.get("origin")).toBe("THR");
    expect(params.get("destination")).toBe("MHD");
    // Jalali, because a Gregorian date silently returns an empty list on the real site.
    expect(params.get("departureDate")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.get("departureDate")).not.toBe("2026-11-20");
    // Context only, not a filter the source understands.
    expect(params.get("departureTime")).toBe("04:00");
    expect(params.get("airline")).toBe("IR");
  });

  it("never caches the hop", async () => {
    const { cache } = await call("origin=THR&destination=MHD&date=2026-11-20");
    expect(cache).toBe("no-store");
  });

  it.each([
    ["missing date", "origin=THR&destination=MHD"],
    ["malformed date", "origin=THR&destination=MHD&date=20-11-2026"],
    ["unknown city", "origin=XXX&destination=MHD&date=2026-11-20"],
    ["missing destination", "origin=THR&date=2026-11-20"],
  ])("falls back inside the app for a %s", async (_label, query) => {
    const { status, location } = await call(query);
    expect(status).toBe(302);
    expect(location).toBe("http://localhost:3000/live");
  });

  it("ignores an injected host: the target is rebuilt, never taken from the request", async () => {
    const { location } = await call(
      "origin=THR&destination=MHD&date=2026-11-20&next=https://evil.test&host=evil.test",
    );
    expect(location.startsWith("https://sepehr360.ir/")).toBe(true);
    expect(location).not.toContain("evil.test");
  });

  it("drops a context value that is not a real clock or airline code", async () => {
    const { location } = await call("origin=THR&destination=MHD&date=2026-11-20&time=99:99&airline=%3Cscript%3E");
    const params = new URL(location).searchParams;
    expect(params.get("departureTime")).toBeNull();
    expect(params.get("airline")).toBeNull();
  });
});
