import { describe, expect, it, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { createElement } from "react";

import { LiveOfferCard } from "@/app/(live)/live/_components/live-offer-card";
import { HistoryChart } from "@/app/(live)/live/history/_components/history-chart";
import type { LiveOfferView } from "@/server/live-search";
import { assembleLiveOffer } from "@/modules/providers/shared/normalize-offer";
import { runLiveSearch } from "@/server/live-search";
import { createQuery } from "@/domain/trip";

/**
 * UI honesty tests for the live surface.
 *
 * The point is not pixel layout — it is that the card cannot *look* more certain than the
 * data is. Each test asserts a specific claim the UI is allowed to make.
 */

const NOW = new Date("2026-11-12T10:00:00.000Z");
const POLICY = { freshMs: 5 * 60_000, staleMs: 20 * 60_000, canClaimAvailability: false, noteFa: "t" };

function view(overrides: Partial<LiveOfferView> = {}): LiveOfferView {
  return {
    id: "sepehr360:key",
    providerId: "sepehr360",
    providerName: "سپهر۳۶۰",
    airlineCode: "IR",
    airlineName: "هما (ایران‌ایر)",
    flightNumber: null,
    originCity: "THR",
    destinationCity: "MHD",
    originAirport: "THR",
    destinationAirport: "MHD",
    departAt: "2026-11-13T04:00:00.000Z",
    arriveAt: "2026-11-13T05:20:00.000Z",
    durationMinutes: 80,
    stops: 0,
    cabin: "economy",
    fareClass: null,
    ticketType: "unknown",
    baggage: { checked: "unknown", checkedKg: null },
    refundable: null,
    price: { toman: 5_902_000, currency: "IRT", amountMinor: 5_902_000, comparable: true, converted: false },
    freshness: "fresh",
    priceObservedAt: NOW.toISOString(),
    lastVerifiedAt: null,
    seatsAvailable: null,
    completeness: 0.2,
    offerUrl: "https://sepehr360.ir/Flight/B2c/Search?origin=THR&destination=MHD&departureDate=1405-08-22",
    sellerLabel: "فروش توسط 128 سایت",
    warnings: ["flight-number-missing", "baggage-unknown"],
    badges: ["best"],
    score: 88.4,
    feasible: true,
    violations: [],
    dataSource: "live",
    ...overrides,
  };
}

afterEach(cleanup);

describe("LiveOfferCard honesty", () => {
  it("says the flight number is unpublished instead of showing a fake one", () => {
    render(createElement(LiveOfferCard, { offer: view(), index: 0 }));
    expect(screen.getByTestId("live-offer-card").textContent).toContain("شماره پرواز اعلام نشده");
  });

  it("shows unknown baggage as unknown", () => {
    render(createElement(LiveOfferCard, { offer: view(), index: 0 }));
    expect(screen.getByText(/بار: نامشخص/)).toBeTruthy();
  });

  it("shows the observation time and that re-verification did not happen", () => {
    render(createElement(LiveOfferCard, { offer: view(), index: 0 }));
    const card = screen.getByTestId("live-offer-card");
    expect(within(card).getByText("مشاهدهٔ قیمت")).toBeTruthy();
    expect(within(card).getByText("انجام نشده")).toBeTruthy();
  });

  it("renders a foreign-currency price without pretending it is toman", () => {
    render(
      createElement(LiveOfferCard, {
        offer: view({
          providerId: "amadeus",
          providerName: "Amadeus",
          price: { toman: 0, currency: "EUR", amountMinor: 31_245, comparable: false, converted: false },
          warnings: ["price-foreign"],
        }),
        index: 0,
      }),
    );
    const card = screen.getByTestId("live-offer-card").textContent ?? "";
    expect(card).toMatch(/۳۱۲\.۴۵/);
    expect(card).toContain("EUR");
    expect(card).toContain("قابل مقایسه با تومان نیست");
    // …and it must NOT show a toman amount for this offer.
    expect(card).not.toContain("تومان۳");
  });

  it("sends a live Sepehr360 offer through our own redirect to the source", () => {
    render(createElement(LiveOfferCard, { offer: view({ dataSource: "live" }), index: 0 }));
    const link = screen.getByTestId("source-link");
    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith("/api/go/sepehr360?")).toBe(true);
    const params = new URL(href, "http://x").searchParams;
    expect(params.get("origin")).toBe("THR");
    expect(params.get("destination")).toBe("MHD");
    expect(params.get("date")).toBe("2026-11-13");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("never links a demo offer to an external source", () => {
    render(
      createElement(LiveOfferCard, {
        offer: view({
          dataSource: "demo",
          offerUrl: "https://example.com/pars/flight/thr-mhd-zv-652?date=2026-11-13&ref=torob-tickets-demo",
          freshness: "demo",
        }),
        index: 0,
      }),
    );
    expect(screen.queryByTestId("source-link")).toBeNull();
    expect(screen.getByTestId("source-link-note").textContent).toContain("نمونه");
    expect(screen.getByText(/همین مسیر در مقایسه/).getAttribute("href")).toContain("/search?");
  });

  it("discloses that the source link is a search page, not this fare", () => {
    render(createElement(LiveOfferCard, { offer: view(), index: 0 }));
    expect(screen.getByText(/لینک، صفحهٔ جست‌وجوی منبع است/)).toBeTruthy();
  });

  it("states excluded offers' reasons instead of hiding them", () => {
    render(
      createElement(LiveOfferCard, {
        offer: view({ feasible: false, violations: ["بلیت قابل استرداد نیست"], badges: [] }),
        index: 0,
      }),
    );
    expect(screen.getByText(/خارج از خواستهٔ شما: بلیت قابل استرداد نیست/)).toBeTruthy();
  });

  it("marks a demo-mode offer as sample data", () => {
    render(createElement(LiveOfferCard, { offer: view({ dataSource: "demo", freshness: "demo" }), index: 0 }));
    expect(screen.getByText("نمونه")).toBeTruthy();
  });
});

describe("HistoryChart honesty", () => {
  const point = (observedAt: string, priceToman: number) => ({ observedAt, priceToman, freshness: "fresh", providerId: "sepehr360" });

  it("says a single observation has no trend line", () => {
    render(createElement(HistoryChart, { points: [point("2026-11-12T09:00:00.000Z", 5_000_000)] }));
    expect(screen.getByText(/خط روند معنا ندارد/)).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("۱ مشاهده");
  });

  it("reports the min/max summary for a multi-point series without interpolation claims", () => {
    render(
      createElement(HistoryChart, {
        points: [point("2026-11-10T09:00:00.000Z", 5_000_000), point("2026-11-12T09:00:00.000Z", 4_600_000)],
      }),
    );
    const caption = screen.getByText(/بدون پر کردن فاصله‌ها/);
    expect(caption).toBeTruthy();
  });

  it("renders nothing misleading for an empty series", () => {
    render(createElement(HistoryChart, { points: [] }));
    expect(screen.getByText(/مشاهده‌ای ثبت نشده است/)).toBeTruthy();
  });
});

describe("live search payload in demo mode", () => {
  it("keeps demo data labelled and never claims a live source", async () => {
    const query = createQuery({ originCode: "THR", destinationCode: "MHD", departDate: "2026-11-20" });
    const payload = await runLiveSearch(query, { mode: "demo", persist: false });

    expect(payload.mode).toBe("demo");
    expect(payload.warnings).toContain("demo-mode");
    expect(payload.offers.length).toBeGreaterThan(0);
    expect(payload.offers.every((offer) => offer.dataSource === "demo")).toBe(true);
    expect(payload.offers.every((offer) => offer.freshness === "demo")).toBe(true);
    // No persistence attempt without a database, and the reason is stated.
    expect(payload.persistence.attempted).toBe(false);
    expect(payload.persistence.reasonFa).toBeTruthy();
  });

  it("deduplicates identical rows before ranking", async () => {
    const query = createQuery({ originCode: "THR", destinationCode: "MHD", departDate: "2026-11-20" });
    const payload = await runLiveSearch(query, { mode: "demo", persist: false });
    const ids = payload.offers.map((offer) => offer.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("normalizer used by the card", () => {
  it("keeps a sparse row sparse", () => {
    const offer = assembleLiveOffer(
      {
        providerId: "sepehr360",
        providerName: "سپهر۳۶۰",
        sourceKind: "html",
        endpoint: "GET /Flight/B2c/Search",
        rawRecordId: null,
        sellerLabel: null,
        airlineCode: "IR",
        flightNumber: null,
        originAirport: "THR",
        destinationAirport: "MHD",
        departAt: "2026-11-13T04:00:00.000Z",
        arriveAt: "2026-11-13T05:20:00.000Z",
        durationMinutes: 80,
        segments: [],
        price: {
          originalAmount: 5_902_000,
          currency: "IRT",
          currencyScale: 1,
          declaredUnit: "toman",
          toman: 5_902_000,
          converted: false,
        },
        baggage: { checked: "unknown", cabinKg: null, checkedKg: null },
        refundable: null,
        cabin: "economy",
        fareClass: null,
        fareName: null,
        ticketType: "unknown",
        marketingCarrier: null,
        offerUrl: "https://sepehr360.ir/Flight/B2c/Search?origin=THR",
        providerUpdatedAt: NOW.toISOString(),
        fetchedAt: NOW.toISOString(),
        seatsAvailable: null,
        unitConverted: false,
      },
      { freshness: POLICY, now: NOW },
    );

    expect(offer.flightNumber).toBeNull();
    expect(offer.refundable).toBeNull();
    expect(offer.baggage.checked).toBe("unknown");
    expect(offer.warnings).toContain("availability-unverified");
  });
});
