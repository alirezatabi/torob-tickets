/**
 * Grounding checks for model-generated explanations.
 *
 * The LLM is only allowed to *rephrase* facts we already computed. Before any
 * generated sentence reaches the user we verify:
 *  1. every number it mentions exists in the fact payload,
 *  2. it does not mention a provider flight that is not the recommended one,
 *  3. it does not claim baggage/refundability when that field is unknown,
 *  4. it stays short and in Persian.
 *
 * Any violation → discard and use the deterministic template.
 */

import { toLatinDigits } from "@/lib/format";

export interface GroundingFacts {
  /** Numbers the model may cite (toman prices, minutes, hours, stops, kg). */
  allowedNumbers: number[];
  /** False when the baggage allowance is unknown. */
  baggageKnown: boolean;
  /** False when refundability is unknown. */
  refundKnown: boolean;
  /** Airline names the model may mention. */
  allowedAirlines: string[];
  /** Flight number of the recommended offer, if any. */
  flightNumber: string | null;
}

export interface GroundingCheck {
  ok: boolean;
  violations: string[];
}

const BAGGAGE_CLAIM = /بار|چمدان/;
const REFUND_CLAIM = /استرداد|بازگشت\s*پول|کنسل/;
const NEGATED_BAGGAGE = /بدون\s*بار|بار\s*ندارد|بار\s*همراه\s*ندارد/;

/** Extract numbers from Persian/Arabic/Latin text, including "۴٫۵ میلیون". */
export function extractNumbers(text: string): number[] {
  const latin = toLatinDigits(text).replace(/٫/g, ".").replace(/[٬,]/g, "");
  const numbers: number[] = [];

  const million = /(\d+(?:\.\d+)?)\s*میلیون/g;
  let match: RegExpExecArray | null;
  while ((match = million.exec(latin)) !== null) {
    numbers.push(Number(match[1]) * 1_000_000);
  }

  const plain = latin.replace(/(\d+(?:\.\d+)?)\s*میلیون/g, " ");
  const tokens = plain.match(/\d+(?:\.\d+)?/g) ?? [];
  for (const token of tokens) numbers.push(Number(token));

  return numbers;
}

/** The explanation may only cite numbers within a small tolerance of allowed ones. */
export function checkGrounding(text: string, facts: GroundingFacts): GroundingCheck {
  const violations: string[] = [];

  if (text.length > 420) violations.push("too-long");
  if (!/[\u0600-\u06FF]/.test(text)) violations.push("not-persian");

  for (const number of extractNumbers(text)) {
    const allowed = facts.allowedNumbers.some((candidate) => {
      if (candidate === number) return true;
      // tolerate rounded forms (e.g. 4.2M for 4_250_000) and hour<->minute restatements
      if (Math.abs(candidate - number) <= Math.max(1, candidate * 0.02)) return true;
      if (Math.abs(candidate / 60 - number) <= 0.2) return true;
      if (Math.abs(number / 60 - candidate) <= 0.2) return true;
      return false;
    });
    if (!allowed) violations.push(`unsupported-number:${number}`);
  }

  if (!facts.baggageKnown && BAGGAGE_CLAIM.test(text) && !NEGATED_BAGGAGE.test(text)) {
    violations.push("claims-unknown-baggage");
  }
  if (!facts.refundKnown && REFUND_CLAIM.test(text)) {
    violations.push("claims-unknown-refund");
  }

  const flightCodes = text.match(/\b[A-Z]{1,2}-?\s?\d{1,4}\b/gi) ?? [];
  for (const code of flightCodes) {
    const normalized = code.replace(/[\s-]/g, "").toUpperCase();
    const expected = facts.flightNumber?.replace(/[\s-]/g, "").toUpperCase();
    if (expected && normalized !== expected) violations.push(`wrong-flight:${code}`);
  }

  return { ok: violations.length === 0, violations };
}
