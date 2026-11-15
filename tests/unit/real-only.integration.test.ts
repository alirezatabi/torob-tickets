import { beforeEach, describe, expect, it, vi } from "vitest";

// Keep the server-page integration focused on service/data boundaries; client-only controls
// require a mounted Next router and are exercised in their dedicated component suites.
vi.mock("@/app/(search)/search/_components/filter-sidebar", () => ({ FilterSidebar: () => null }));
vi.mock("@/app/(search)/search/_components/mobile-filters", () => ({ MobileFilters: () => null }));
vi.mock("@/app/(search)/search/_components/sort-tabs", () => ({ SortTabs: () => null }));
vi.mock("@/app/(search)/search/_components/date-strip", () => ({ DateStrip: () => null }));

import { GET as searchGet } from "@/app/api/search/route";
import { GET as liveSearchGet } from "@/app/api/live/search/route";
import { GET as historyGet } from "@/app/api/live/history/route";
import { GET as crawlGet } from "@/app/api/crawl/route";
import { GET as healthGet } from "@/app/api/health/route";
import { POST as explainPost } from "@/app/api/explain/route";
import { POST as intentPost } from "@/app/api/intent/route";
import SearchPage from "@/app/(search)/search/page";
import FlightPage from "@/app/(search)/flight/page";
import ComparePage from "@/app/(search)/compare/page";
import { renderToStaticMarkup } from "react-dom/server";
import { parseSearchParams } from "@/lib/search-params";
import { searchTrips } from "@/server/search-service";
import { resetRateLimits } from "@/modules/api/rate-limit";
import { addDays, isoToday } from "@/lib/jalali";

beforeEach(() => resetRateLimits());

function url(path: string): Request {
  return new Request(`http://localhost${path}`);
}

function containsDemoOffer(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsDemoOffer);
  if (value === null || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  if (object.dataSource === "demo") return true;
  return Object.values(object).some(containsDemoOffer);
}

describe("site entry points remain real-snapshot-only", () => {
  it("does not expose demo offers even when the URL requests demo data", async () => {
    const requestedDate = addDays(isoToday(new Date()), 14);
    const parsed = parseSearchParams({
      origin: "THR",
      destination: "MHD",
      date: requestedDate,
      source: "demo",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // /search, /flight, /compare and /api/explain share this server façade.
    const pageView = await searchTrips(parsed.query, "cheapest", { now: new Date("2026-11-12T08:00:00.000Z") });
    expect(pageView.outcome.query.filters.dataSource).toBe("real");
    expect(containsDemoOffer(pageView)).toBe(false);

    const apiResponse = await searchGet(url(`/api/search?origin=THR&destination=MHD&date=${requestedDate}&source=demo`));
    expect(apiResponse.status).toBe(200);
    const apiBody = await apiResponse.json();
    expect(apiBody.meta.demoData).toBe(false);
    expect(apiBody.query.filters.dataSource).toBe("real");
    expect(containsDemoOffer(apiBody)).toBe(false);

    const retiredLiveSearch = await liveSearchGet();
    expect(retiredLiveSearch.status).toBe(410);
    expect(containsDemoOffer(await retiredLiveSearch.json())).toBe(false);

    const history = await historyGet(url(`/api/live/history?origin=THR&destination=MHD&date=${requestedDate}`));
    expect(history.status).toBe(200);
    expect(containsDemoOffer(await history.json())).toBe(false);

    const invalidHistory = await historyGet(url("/api/live/history?origin=THR&destination=MHD&date=2026-02-30"));
    expect(invalidHistory.status).toBe(400);

    const crawlStatus = await crawlGet(url("/api/crawl"));
    expect(crawlStatus.status).toBe(200);
    expect(containsDemoOffer(await crawlStatus.json())).toBe(false);

    const health = await healthGet(url("/api/health"));
    expect(health.status).toBe(200);
    expect(containsDemoOffer(await health.json())).toBe(false);

    const explanation = await explainPost(new Request("http://localhost/api/explain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origin: "THR", destination: "MHD", date: requestedDate }),
    }));
    expect([404, 200]).toContain(explanation.status);
    expect(containsDemoOffer(await explanation.json())).toBe(false);

    const intent = await intentPost(new Request("http://localhost/api/intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "پرواز تهران به مشهد فردا" }),
    }));
    expect(intent.status).toBe(200);
    expect(containsDemoOffer(await intent.json())).toBe(false);
  });

  it("keeps search, flight, and compare pages empty when no real snapshot exists", async () => {
    const requestedDate = addDays(isoToday(new Date()), 14);
    const params = Promise.resolve({ origin: "THR", destination: "MHD", date: requestedDate });
    const searchElement = await SearchPage({ searchParams: params });
    const searchHtml = renderToStaticMarkup(searchElement);
    expect(searchHtml).toContain("snapshot واقعی Safarmarket");
    expect(searchHtml).toContain("/crawl");
    expect(searchHtml).not.toMatch(/\b(?:DEMO|demo-offer|demo-provider)\b/);

    const flightElement = await FlightPage({ searchParams: Promise.resolve({
      origin: "THR", destination: "MHD", date: requestedDate, offer: "demo:fake-offer",
    }) });
    const flightHtml = renderToStaticMarkup(flightElement);
    expect(flightHtml).toContain("این بلیت در نتایج این جستجو نبود");
    expect(flightHtml).not.toMatch(/\b(?:DEMO|demo-offer|demo-provider)\b/);

    const compareElement = await ComparePage({ searchParams: Promise.resolve({
      origin: "THR", destination: "MHD", date: requestedDate, groups: "demo:fake-offer",
    }) });
    const compareHtml = renderToStaticMarkup(compareElement);
    expect(compareHtml).toContain("گزینه‌ای انتخاب نشده");
    expect(compareHtml).not.toMatch(/\b(?:DEMO|demo-offer|demo-provider)\b/);
  });
});
