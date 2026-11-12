/**
 * Re-verification of a stored Amadeus offer.
 *
 * Amadeus' `/v1/shopping/flight-offers/pricing` takes the **original offer payload**,
 * not just an id. We do not keep provider payloads in Postgres (they are bulky and can
 * contain nothing we need), so verification is only possible while the raw offer is
 * still in hand — i.e. during the same request that produced it.
 *
 * That is an honest, documented limitation rather than a fake feature: this module
 * *does* verify during a search (and records `lastVerifiedAt`), and returns an explicit
 * "not verifiable later" result otherwise. The UI shows `تأیید مجدد: انجام نشده` in that
 * case instead of implying the price is confirmed.
 */

import type { AmadeusAdapter } from "./adapter";
import type { AmadeusRepricingResult, AmadeusRawOffer } from "./parse";

export type VerificationOutcome =
  | { status: "verified"; total: { amount: number; currency: string }; priceChanged: boolean; verifiedAt: string }
  | { status: "unavailable"; reasonFa: string }
  | { status: "not-possible"; reasonFa: string };

export async function verifyAmadeusOffer(
  adapter: AmadeusAdapter,
  record: AmadeusRawOffer,
  expected: { amountMinor: number; currency: string },
  now: Date = new Date(),
): Promise<VerificationOutcome> {
  if (!adapter.isConfigured()) {
    return { status: "not-possible", reasonFa: "کلیدهای Amadeus تنظیم نشده است؛ تأیید مجدد ممکن نیست." };
  }

  let result: AmadeusRepricingResult;
  try {
    result = await adapter.verifyOffer(record.raw);
  } catch {
    return { status: "not-possible", reasonFa: "ارتباط با Amadeus برای تأیید قیمت برقرار نشد." };
  }

  if (!result.ok || !result.total) {
    return {
      status: "unavailable",
      reasonFa: result.reason
        ? `Amadeus این نرخ را دوباره قیمت نکرد: ${result.reason}`
        : "Amadeus این نرخ را دوباره قیمت نکرد؛ احتمالاً دیگر قابل فروش نیست.",
    };
  }

  const priceChanged =
    result.total.amount !== expected.amountMinor || result.total.currency !== expected.currency;

  return {
    status: "verified",
    total: result.total,
    priceChanged,
    verifiedAt: now.toISOString(),
  };
}
