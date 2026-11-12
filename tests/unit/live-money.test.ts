import { describe, expect, it } from "vitest";

import {
  buildForeignPrice,
  buildIranianPrice,
  divideInteger,
  normalizeDigits,
  parsePriceText,
  toTomanExact,
} from "@/modules/money/price";

describe("persian/arabic digit normalization", () => {
  it("converts Persian and Arabic digits", () => {
    expect(normalizeDigits("۱۲۳۴۵۶۷۸۹۰")).toBe("1234567890");
    expect(normalizeDigits("١٢٣")).toBe("123");
  });

  it("drops Persian thousands separators and ZWNJ", () => {
    expect(normalizeDigits("۵٬۹۰۲٬۰۰۰")).toBe("5902000");
    expect(normalizeDigits("5,902,000")).toBe("5902000");
  });
});

describe("price text parsing", () => {
  it("parses a Persian price with تومان", () => {
    expect(parsePriceText("۵٬۹۰۲٬۰۰۰ تومان")).toEqual({ amount: 5_902_000, currencyHint: "IRT" });
  });

  it("parses a latin price with ریال", () => {
    expect(parsePriceText("18,108,700 ریال")).toEqual({ amount: 18_108_700, currencyHint: "IRR" });
  });

  it("returns null for text without a number (never 0)", () => {
    expect(parsePriceText("تماس بگیرید")).toBeNull();
    expect(parsePriceText("")).toBeNull();
    expect(parsePriceText(null)).toBeNull();
  });

  it("rejects zero and negative amounts", () => {
    expect(parsePriceText("0 تومان")).toBeNull();
  });
});

describe("unit conversion", () => {
  it("divides rial by 10 with integer rounding", () => {
    expect(divideInteger(5_902_005, 10)).toBe(590_201);
    expect(divideInteger(3, 10)).toBe(0);
  });

  it("converts rial prices to toman exactly once", () => {
    expect(toTomanExact(18_108_700, "IRR", 10)).toBe(1_810_870);
    expect(toTomanExact(5_902_000, "IRT", 1)).toBe(5_902_000);
  });

  it("refuses ambiguous unit combinations instead of guessing", () => {
    expect(() => toTomanExact(5_902_000, "IRR", 1)).toThrow();
    expect(() => toTomanExact(5_902_000, "IRT", 10)).toThrow();
    expect(() => toTomanExact(5_902_000, "USD", 100)).toThrow();
  });
});

describe("buildIranianPrice", () => {
  it("trusts the page when it prints ریال, even if configured as toman", () => {
    const price = buildIranianPrice("18,108,700 ریال", "toman");
    expect(price?.declaredUnit).toBe("rial");
    expect(price?.toman).toBe(1_810_870);
    expect(price?.converted).toBe(true);
  });

  it("keeps toman prices unconverted", () => {
    const price = buildIranianPrice("۵٬۹۰۲٬۰۰۰ تومان", "toman");
    expect(price?.toman).toBe(5_902_000);
    expect(price?.converted).toBe(false);
  });

  it("falls back to the configured unit when the page omits it", () => {
    expect(buildIranianPrice("5,902,000", "toman")?.toman).toBe(5_902_000);
    expect(buildIranianPrice("5,902,000", "rial")?.toman).toBe(590_200);
  });
});

describe("foreign currency prices", () => {
  it("stores cents as an integer and never pretends a toman value", () => {
    const price = buildForeignPrice("1234.56", "eur");
    expect(price).toMatchObject({ originalAmount: 123_456, currency: "EUR", currencyScale: 100, toman: 0 });
  });

  it("pads a single decimal digit", () => {
    expect(buildForeignPrice("99.5", "USD")?.originalAmount).toBe(9_950);
  });

  it("rejects non-numeric input", () => {
    expect(buildForeignPrice("1,234.56", "EUR")).toBeNull();
  });
});
