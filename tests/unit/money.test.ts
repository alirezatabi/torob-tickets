import { describe, expect, it } from "vitest";
import { DEMO_FX_TOMAN, needsConversion, toToman } from "@/domain/money";
import { parseAmount } from "@/providers/normalize";

describe("money normalization", () => {
  it("keeps toman untouched", () => {
    expect(toToman({ amount: 4_250_000, currency: "IRT" })).toBe(4_250_000);
  });

  it("converts rial to toman (10 rial = 1 toman)", () => {
    expect(toToman({ amount: 42_500_000, currency: "IRR" })).toBe(4_250_000);
  });

  it("converts EUR using the demo FX table and rounds to 1 000 toman", () => {
    expect(toToman({ amount: 42.5, currency: "EUR" })).toBe(42.5 * DEMO_FX_TOMAN.EUR);
    expect(toToman({ amount: 42.53, currency: "EUR" }) % 1_000).toBe(0);
  });

  it("flags currencies that needed conversion", () => {
    expect(needsConversion({ amount: 1, currency: "IRT" })).toBe(false);
    expect(needsConversion({ amount: 1, currency: "IRR" })).toBe(true);
    expect(needsConversion({ amount: 1, currency: "EUR" })).toBe(true);
  });

  it("rejects negative and unknown-currency input instead of silently fixing it", () => {
    expect(() => toToman({ amount: -5, currency: "IRT" })).toThrow();
    expect(() => toToman({ amount: 5, currency: "GBP" as never })).toThrow();
  });

  it("parses provider price strings with Persian digits and separators", () => {
    expect(parseAmount("۴٬۲۵۰٬۰۰۰")).toBe(4_250_000);
    expect(parseAmount("42,500,000")).toBe(42_500_000);
    expect(parseAmount("۴۲٫۵ EUR")).toBe(42.5);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });
});
