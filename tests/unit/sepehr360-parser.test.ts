import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseSearchPage } from "@/modules/providers/sepehr360/parser";
import { parsePersianDuration, parseStops, parseWallClock } from "@/modules/providers/sepehr360/parse-duration";
import { buildSearchUrl, toJalaliQueryDate } from "@/modules/providers/sepehr360/url";
import { matchPersianAirport } from "@/modules/providers/sepehr360/adapter";

const fixture = (name: string) =>
  readFileSync(path.join(process.cwd(), "src/modules/providers/sepehr360/__fixtures__", name), "utf8");

describe("sepehr360 parser", () => {
  it("extracts every result card from a real-shaped page", () => {
    const result = parseSearchPage(fixture("thr-mhd.html"));

    expect(result.meta.resultCount).toBe(23);
    expect(result.meta.emptyState).toBe(false);
    expect(result.meta.challenge).toBeNull();
    expect(result.offers).toHaveLength(4);
    expect(result.warnings).toEqual([]);
  });

  it("reads price, times, airline, cabin and stops from a card", () => {
    const [first] = parseSearchPage(fixture("thr-mhd.html")).offers;
    expect(first).toMatchObject({
      airlineCode: "IR",
      departTime: "07:30",
      arriveTime: "08:50",
      priceAmount: 5_902_000,
      cabinLabel: "اکونومی",
      stopsLabel: "مستقیم",
      originLabel: "مهرآباد",
      destinationLabel: "مشهد",
    });
    expect(first?.durationText).toContain("ساعت");
  });

  it("keeps a missing duration as null instead of inventing one", () => {
    const third = parseSearchPage(fixture("thr-mhd.html")).offers[2];
    expect(third?.durationText).toBeNull();
    expect(third?.priceAmount).toBe(4_850_000);
  });

  it("normalizes Persian digits and separators in the price text", () => {
    const result = parseSearchPage(fixture("thr-mhd.html"));
    // The page prints "۵٬۹۰۲٬۰۰۰" — the raw text keeps the digits, amount is numeric.
    expect(result.offers[0]?.priceText).toContain("تومان");
    expect(result.offers[0]?.priceAmount).toBe(5_902_000);
  });

  it("detects an explicit empty state", () => {
    const result = parseSearchPage(fixture("empty.html"));
    expect(result.meta.emptyState).toBe(true);
    expect(result.offers).toEqual([]);
  });

  it("detects a CAPTCHA wall instead of returning an empty result set", () => {
    const result = parseSearchPage(fixture("captcha.html"));
    expect(result.meta.challenge).toBe("captcha");
    expect(result.offers).toEqual([]);
  });

  it("warns when the markup yields no cards and no empty state", () => {
    const result = parseSearchPage("<html><body><p>سلام</p></body></html>");
    expect(result.offers).toEqual([]);
    expect(result.warnings).toContain("no-result-cards-found");
  });

  it("ignores prices inside scripts", () => {
    const html = `<html><body>
      <script>window.__PRICE__ = 5_902_000;</script>
      <div class="card"><span>07:30</span><span>09:00</span><span>5,902,000 تومان</span></div>
    </body></html>`;
    const result = parseSearchPage(html);
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]?.priceAmount).toBe(5_902_000);
  });
});

describe("sepehr360 duration/stops/wall-clock parsing", () => {
  it("parses Persian durations", () => {
    expect(parsePersianDuration("۱ ساعت و ۳۰ دقیقه")?.minutes).toBe(90);
    expect(parsePersianDuration("2 ساعت")?.minutes).toBe(120);
    expect(parsePersianDuration("۴۵ دقیقه")?.minutes).toBe(45);
    expect(parsePersianDuration("1:15")?.minutes).toBe(75);
    expect(parsePersianDuration("")).toBeNull();
    expect(parsePersianDuration(null)).toBeNull();
  });

  it("parses stop labels without assuming", () => {
    expect(parseStops("مستقیم")).toBe(0);
    expect(parseStops("یک توقف")).toBe(1);
    expect(parseStops("۲ توقف")).toBe(2);
    expect(parseStops("پرواز")).toBeNull();
  });

  it("parses wall clocks and rejects impossible ones", () => {
    expect(parseWallClock("05:30")).toBe(330);
    expect(parseWallClock("۲۳:۵۹")).toBe(1439);
    expect(parseWallClock("25:00")).toBeNull();
    expect(parseWallClock("—")).toBeNull();
  });
});

describe("sepehr360 url building", () => {
  it("uses the Jalali date the site expects", () => {
    expect(toJalaliQueryDate("2026-11-13")).toBe("1405-08-22");
  });

  it("uses the domestic airport for domestic routes", () => {
    const target = buildSearchUrl({ originCity: "THR", destinationCity: "MHD", departDate: "2026-11-13" });
    expect(target.originAirport).toBe("THR");
    expect(target.url).toContain("origin=THR");
    expect(target.url).toContain("destination=MHD");
    expect(target.url).toContain("departureDate=1405-08-22");
  });

  it("uses the international airport for international routes", () => {
    const target = buildSearchUrl({ originCity: "THR", destinationCity: "IST", departDate: "2026-11-13" });
    expect(target.originAirport).toBe("IKA");
    expect(target.destinationAirport).toBe("IST");
  });

  it("refuses to build a URL for an unknown city", () => {
    expect(() => buildSearchUrl({ originCity: "XXX", destinationCity: "MHD", departDate: "2026-11-13" })).toThrow();
  });
});

describe("sepehr360 persian airport labels", () => {
  it("maps the labels the page prints", () => {
    expect(matchPersianAirport("از مهرآباد")).toBe("THR");
    expect(matchPersianAirport("امام خمینی")).toBe("IKA");
    expect(matchPersianAirport("به مشهد")).toBe("MHD");
    expect(matchPersianAirport("دبی")).toBe("DXB");
  });

  it("returns null rather than guessing an unknown label", () => {
    expect(matchPersianAirport("نامشخص")).toBeNull();
  });
});
