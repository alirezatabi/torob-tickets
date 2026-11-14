/**
 * Money handling.
 *
 * Every provider quotes prices in its own currency and unit. We always keep the
 * original amount (for provenance and honest display) and additionally compute a
 * normalized `toman` value used by ranking and filtering.
 *
 * The FX table below is a *demo* fixture, not a live feed. Conversion is marked
 * with a warning on the offer so the UI can disclose it.
 */

export const CURRENCIES = ["IRR", "IRT", "USD", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];

/**
 * Demo FX rates, expressed as "how many toman is one unit".
 * 1 EUR ≈ 100_000 toman, 1 USD ≈ 92_000 toman, 1 IRR = 0.1 toman (10 rial = 1 toman).
 */
export const DEMO_FX_TOMAN: Record<Currency, number> = {
  IRR: 0.1,
  IRT: 1,
  USD: 92_000,
  EUR: 100_000,
};

export const FX_SNAPSHOT_LABEL = "نرخ تبدیل نمونه (تیر ۱۴۰۴)";

export interface Money {
  amount: number;
  currency: Currency;
}

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

/**
 * Convert supported money values to toman. Rial uses the exact 10:1 unit conversion,
 * while foreign-currency demo rates are rounded to the nearest 1 000 toman.
 */
export function toToman(money: Money, rates: Record<Currency, number> = DEMO_FX_TOMAN): number {
  if (!Number.isFinite(money.amount) || money.amount < 0) {
    throw new Error(`Invalid money amount: ${money.amount}`);
  }
  const rate = rates[money.currency];
  if (rate === undefined) {
    throw new Error(`Unknown currency: ${money.currency}`);
  }
  const raw = money.amount * rate;
  if (money.currency === "IRT" || money.currency === "IRR") return Math.round(raw);

  return Math.round(raw / 1_000) * 1_000;
}

/** True when the price needed an FX conversion (i.e. was not already in toman). */
export function needsConversion(money: Money): boolean {
  return money.currency !== "IRT";
}
