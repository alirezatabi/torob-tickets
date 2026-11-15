import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { HistoryChart } from "@/app/(live)/live/history/_components/history-chart";

afterEach(cleanup);

describe("HistoryChart displays only persisted observations", () => {
  const point = (observedAt: string, priceToman: number) => ({ observedAt, priceToman, freshness: "unverified", providerId: "safarmarket-seller" });

  it("says a single observation has no trend line", () => {
    render(createElement(HistoryChart, { points: [point("2026-11-12T09:00:00.000Z", 5_000_000)] }));
    expect(screen.getByText(/خط روند معنا ندارد/)).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("۱ مشاهده");
  });

  it("reports the observed min/max without interpolating missing prices", () => {
    render(createElement(HistoryChart, {
      points: [point("2026-11-10T09:00:00.000Z", 5_000_000), point("2026-11-12T09:00:00.000Z", 4_600_000)],
    }));
    expect(screen.getByText(/بدون پر کردن فاصله‌ها/)).toBeTruthy();
  });

  it("renders an honest empty state when no real observation exists", () => {
    render(createElement(HistoryChart, { points: [] }));
    expect(screen.getByText(/مشاهده‌ای ثبت نشده است/)).toBeTruthy();
  });
});
