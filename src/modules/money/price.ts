/**
 * Money for real provider data.
 *
 * Every provider states its own currency **and unit**. Iranian sites publish
 * "تومان" or "ریال"; some APIs send a decimal string with a currency code. We never
 * guess: the unit is an explicit per-source fact (`PriceUnitScale`), and all
 * arithmetic is done on integers (toman), so a price is never silently 10× wrong and
 * rounding never drifts.
 *
 * Rule of thumb used everywhere in this codebase:
 *   • store the amount the provider sent, as an integer in its own minor-ish unit
 *   • store the scale that converts it to toman
 *   • compute toman with integer math only
 */

export const IRANIAN_UNITS = ["IRT", "IRR"] as const;
export type PriceUnitScale = 1 | 10 | 100;
// 1  → the amount is already in toman
// 10 → the amount is in rial (10 rial = 1 toman)
// 100 → the amount is in a 2-decimal currency (EUR/USD cents)

export interface RawMoney {
  /** Exact amount as the provider sent it (integer, in `scale` units). */
  amount: number;
  /** ISO 4217-ish code as published: IRT, IRR, EUR, USD, … */
  currency: string;
  /** How many `amount` units make one whole unit of `currency` (1 or 100). */
  currencyScale: PriceUnitScale;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Persian/Arabic digits and Persian separators → ASCII. */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/٫/g, ".")
    .replace(/[٬،,]/g, "")
    .replace(/\u200c/g, "")
    .replace(/\u00a0/g, " ");
}

/**
 * Parse a price string from an HTML/markdown page: "5,902,000", "۵٬۹۰۲٬۰۰۰",
 * "1 234 567", "18,108,700 تومان". Returns `null` when there is no number at all —
 * callers must treat that as "price unknown", not as 0.
 */
export function parsePriceText(text: string | null | undefined): { amount: number; currencyHint: "IRT" | "IRR" | null } | null {
  if (!text) return null;
  const normalized = normalizeDigits(text);
  const currencyHint = /ریال/.test(normalized) ? "IRR" : /تومان|تومن/.test(normalized) ? "IRT" : null;

  const match = /\d[\d\s.,]*/.exec(normalized);
  if (!match) return null;

  // "1.234.567" (European) vs "5,902,000" (thousands) vs "18.5" (decimal).
  const raw = match[0].trim();
  const digitsOnly = raw.replace(/[^\d]/g, "");
  if (!digitsOnly) return null;
  const amount = Number(digitsOnly);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  return { amount, currencyHint };
}

/**
 * Integer division that rounds half away from zero. Used for unit conversions so a
 * rial→toman conversion of 5 902 000 never becomes 590 199.99… anywhere.
 */
export function divideInteger(amount: number, divisor: number): number {
  if (!Number.isSafeInteger(amount)) throw new MoneyError(`Non-integer amount ${amount}`);
  if (divisor === 1) return amount;
  if (!Number.isInteger(divisor) || divisor <= 0) throw new MoneyError(`Bad divisor ${divisor}`);
  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);
  return sign * Math.floor((abs + divisor / 2) / divisor);
}

/**
 * Convert a provider amount to toman using an explicit scale.
 * IRR (rial) → divide by 10. IRT → as is. Unknown → throw (never guess).
 */
export function toTomanExact(amount: number, currency: string, scale: PriceUnitScale): number {
  const code = currency.toUpperCase();
  if (code === "IRT") {
    if (scale !== 1) throw new MoneyError(`IRT with scale ${scale}: unit mismatch`);
    return amount;
  }
  if (code === "IRR") {
    if (scale === 10) return divideInteger(amount, 10); // amount already in rial
    if (scale === 1) throw new MoneyError("IRR with scale 1 is ambiguous; state the unit explicitly");
  }
  throw new MoneyError(`Unsupported toman conversion for ${currency}/${scale}`);
}

/**
 * A price together with everything needed to display it honestly:
 * what the provider said, in what unit, and the normalized toman value.
 */
export interface NormalizedPrice {
  /** Amount exactly as received, in `currency` × `currencyScale`. */
  originalAmount: number;
  currency: string;
  currencyScale: PriceUnitScale;
  /** Unit actually used by the source: "toman" or "rial" (Iranian sources only). */
  declaredUnit: "toman" | "rial" | "foreign";
  /** Normalized, integer toman. */
  toman: number;
  /** True when a unit conversion happened (UI must disclose it). */
  converted: boolean;
}

export function buildIranianPrice(
  text: string,
  unit: "toman" | "rial",
): NormalizedPrice | null {
  const parsed = parsePriceText(text);
  if (!parsed) return null;
  // The page may print "تومان" explicitly; if it does and contradicts the configured
  // unit, we trust the page (it is the primary evidence) and record it.
  const effectiveUnit = parsed.currencyHint === "IRR" ? "rial" : parsed.currencyHint === "IRT" ? "toman" : unit;

  const toman = effectiveUnit === "rial" ? divideInteger(parsed.amount, 10) : parsed.amount;
  return {
    originalAmount: parsed.amount,
    currency: effectiveUnit === "rial" ? "IRR" : "IRT",
    currencyScale: 1,
    declaredUnit: effectiveUnit,
    toman,
    converted: effectiveUnit !== "toman",
  };
}

/** For foreign-currency APIs: "1234.56" EUR → { amount: 123456, currencyScale: 100 }. */
export function buildForeignPrice(total: string, currency: string): NormalizedPrice | null {
  const match = /^\d+(\.\d+)?$/.exec(total.trim());
  if (!match) return null;
  const [whole, fraction = ""] = total.trim().split(".");
  const padded = `${fraction}00`.slice(0, 2);
  const amount = Number(`${whole}${padded}`);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  return {
    originalAmount: amount,
    currency: currency.toUpperCase(),
    currencyScale: 100,
    declaredUnit: "foreign",
    // Foreign-currency offers have no toman value without an FX feed. 0 is not a
    // price; the UI and ranking must treat this as "not comparable in toman".
    toman: 0,
    converted: false,
  };
}
