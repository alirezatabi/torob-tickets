import type { OfferGroup, FlightOffer } from "@/domain/flight";
import { formatDuration, formatStopsShort, formatToman, toPersianDigits } from "@/lib/format";
import { airlineLabel } from "@/lib/airlines";
import type { RankedResult, ScoredOffer } from "./score";

/**
 * Persian explanations built from *facts*, not prose generation.
 *
 * These strings are:
 *  - the offline/default explanation (so the product works with no API key),
 *  - the grounding reference for the LLM upgrade (the model may only restate
 *    what is listed here, never add numbers or claims).
 */

export interface ExplanationFacts {
  flightNumber: string | null;
  airline: string;
  priceToman: number;
  durationMinutes: number;
  stops: number;
  baggage: string;
  refundable: string;
  departTime?: string;
  savingsVsAverage: number;
  priceDeltaVsCheapest: number;
  durationDeltaVsFastest: number;
  label: "cheapest" | "fastest" | "balanced" | "only";
}

/** Only values that literally appear in the offer are exported — no inference. */
export function baggageLabel(offer: FlightOffer): string {
  if (offer.baggage.checked === "included") {
    return offer.baggage.checkedKg !== null ? `بار ${toPersianDigits(offer.baggage.checkedKg)} کیلوگرمی` : "بار همراه دارد";
  }
  if (offer.baggage.checked === "not-included") return "بدون بار همراه";
  return "اطلاعات بار نامشخص";
}

export function refundLabel(offer: FlightOffer): string {
  if (offer.refundable === true) return "قابل استرداد";
  if (offer.refundable === false) return "غیرقابل استرداد";
  return "شرایط استرداد نامشخص";
}

export function buildFacts(offer: FlightOffer, result: RankedResult): ExplanationFacts {
  const prices = result.ranked.map((s) => s.offer.price.toman);
  const average = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : offer.price.toman;
  const cheapest = result.cheapest?.offer.price.toman ?? offer.price.toman;
  const fastest = result.fastest?.offer.durationMinutes ?? offer.durationMinutes;

  const isCheapest = result.cheapest?.offer.id === offer.id;
  const isFastest = result.fastest?.offer.id === offer.id;

  return {
    flightNumber: offer.flightNumber,
    airline: airlineLabel(offer.airlineCode),
    priceToman: offer.price.toman,
    durationMinutes: offer.durationMinutes,
    stops: offer.stops,
    baggage: baggageLabel(offer),
    refundable: refundLabel(offer),
    savingsVsAverage: Math.round(average - offer.price.toman),
    priceDeltaVsCheapest: offer.price.toman - cheapest,
    durationDeltaVsFastest: offer.durationMinutes - fastest,
    label: isCheapest && isFastest ? "only" : isCheapest ? "cheapest" : isFastest ? "fastest" : "balanced",
  };
}

/** Deterministic Persian explanation of why this offer is (or is not) the best match. */
export function explainRecommendation(offer: FlightOffer, result: RankedResult): string {
  const facts = buildFacts(offer, result);
  const parts: string[] = [];

  const name = facts.flightNumber ? `${facts.airline} (${facts.flightNumber})` : facts.airline;
  const score = result.ranked.find((scored) => scored.offer.id === offer.id)?.score ?? 0;
  parts.push(`${name} با امتیاز ${toPersianDigits(Math.round(score))} از ۱۰۰ بهترین تطابق است.`);

  const reasons: string[] = [];
  if (facts.priceDeltaVsCheapest === 0) {
    reasons.push("ارزان‌ترین گزینهٔ این جستجو است");
  } else {
    reasons.push(
      `${formatToman(facts.priceDeltaVsCheapest)} گران‌تر از ارزان‌ترین گزینه است`,
    );
  }
  if (facts.durationDeltaVsFastest === 0) {
    reasons.push("سریع‌ترین زمان رسیدن را دارد");
  } else if (facts.durationDeltaVsFastest > 0) {
    reasons.push(`${formatDuration(facts.durationDeltaVsFastest)} کندتر از سریع‌ترین پرواز است`);
  }
  reasons.push(formatStopsShort(offer.stops) === "مستقیم" ? "پرواز مستقیم است" : `${formatStopsShort(offer.stops)} دارد`);
  reasons.push(facts.baggage);
  if (offer.refundable === true) reasons.push("قابل استرداد است");

  parts.push(`${reasons.join("، ")}.`);

  const excluded = result.excluded.length;
  if (excluded > 0 && result.feasible.length > 0) {
    parts.push(
      `${toPersianDigits(excluded)} گزینه به‌دلیل نداشتن شرایط درخواستی شما در فهرست «خارج از ترجیحات» قرار گرفته است.`,
    );
  }

  return parts.join(" ");
}

/** Deterministic comparison of two offers, used by the comparison view. */
export function explainTradeoff(a: ScoredOffer, b: ScoredOffer): string {
  const priceDiff = b.offer.price.toman - a.offer.price.toman;
  const durationDiff = b.offer.durationMinutes - a.offer.durationMinutes;
  const bits: string[] = [];

  if (Math.abs(priceDiff) > 0) {
    bits.push(
      priceDiff > 0
        ? `${a.offer.airlineName} ${formatToman(Math.abs(priceDiff))} ارزان‌تر است`
        : `${b.offer.airlineName} ${formatToman(Math.abs(priceDiff))} ارزان‌تر است`,
    );
  } else {
    bits.push("قیمت دو گزینه یکسان است");
  }
  if (durationDiff !== 0) {
    bits.push(
      durationDiff > 0
        ? `${a.offer.airlineName} ${formatDuration(Math.abs(durationDiff))} سریع‌تر است`
        : `${b.offer.airlineName} ${formatDuration(Math.abs(durationDiff))} سریع‌تر است`,
    );
  }
  return bits.join("، ") + ".";
}

export function groupSummary(group: OfferGroup): string {
  const count = group.providers.length;
  if (count <= 1) return group.primary.providerName;
  return `${toPersianDigits(count)} ارائه‌دهنده`;
}
