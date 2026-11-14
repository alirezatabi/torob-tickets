import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CrawledOffersBrowser } from "@/app/(search)/crawl/_components/crawled-offers-browser";
import type { CrawlSnapshot, RawOffer } from "@/crawler/types";

function makeOffer(id: string, flightNumber: string, providerName: string, amount: number): RawOffer {
  return {
    id, origin: "THR", destination: "MHD", departAt: "2026-11-22T10:50:00.000Z", arriveAt: "2026-11-22T12:10:00.000Z",
    airline: "Fly Persia", airlineCode: "FP", flightNumber, amount, currency: "IRT", seats: 5, offerUrl: null,
    providerId: providerName.toLowerCase().replaceAll(" ", "-"), providerName, flightClass: "ECONOMY", stopsCount: 0,
    departureLocal: "2026-11-22 14:20", arrivalLocal: "2026-11-22 15:40",
  };
}

const snapshot: CrawlSnapshot = {
  schemaVersion: 1,
  source: "safarmarket",
  fetchedAt: "2026-11-14T14:12:00.000Z",
  route: "THR-MHD",
  date: "2026-11-22",
  offers: [
    makeOffer("fp-a", "FP7438", "Vendor A", 81_000_000),
    makeOffer("fp-b", "FP7438", "Vendor B", 82_000_000),
    makeOffer("ir-a", "IR530", "Vendor A", 76_000_000),
  ],
};

describe("crawled ticket explorer", () => {
  it("searches ticket codes and filters provider quotes while retaining one card per code", () => {
    render(<CrawledOffersBrowser snapshot={snapshot} sourceName="Safarmarket" />);
    expect(screen.getByText("کد پرواز یکتا")).toBeTruthy();
    const search = screen.getByLabelText("جستجوی کد، ایرلاین یا فروشنده");
    fireEvent.change(search, { target: { value: "FP7438" } });
    expect(screen.getByRole("heading", { name: "FP7438" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "IR530" })).toBeNull();
    fireEvent.change(screen.getByLabelText("فروشنده"), { target: { value: "Vendor B" } });
    expect(screen.getAllByText("Vendor B").length).toBeGreaterThan(0);
  });

  it("compares selected ticket codes and shows their cheapest seller prices", () => {
    render(<CrawledOffersBrowser snapshot={snapshot} sourceName="Safarmarket" />);
    const checks = screen.getAllByRole("checkbox");
    fireEvent.click(checks[0]!);
    fireEvent.click(checks[1]!);
    expect(screen.getByRole("heading", { name: "مقایسهٔ بلیت‌ها" })).toBeTruthy();
    expect(screen.getAllByText("۸۱٬۰۰۰٬۰۰۰ تومان").length).toBeGreaterThan(0);
    expect(screen.getAllByText("۷۶٬۰۰۰٬۰۰۰ تومان").length).toBeGreaterThan(0);
  });
});
