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

/**
 * Flight numbers ("TK873", "W5-107") are identifiers, not quantities. They used
 * to be read twice — as an unsupported number *and* as a wrong flight — which
 * rejected every sentence that named the recommended flight.
 */
const FLIGHT_CODE = /\b[A-Z]{2}\s?-?\s?\d{1,4}\b|\b[A-Z]\d-\s?\d{1,4}\b/gi;

const normalizeFlightCode = (code: string) => code.replace(/[\s-]/g, "").toUpperCase();

/** Blank out flight numbers so their digits are not mistaken for prices/minutes. */
export function maskFlightNumbers(text: string): string {
  return text.replace(FLIGHT_CODE, (match) => "x".repeat(match.length));
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

  for (const number of extractNumbers(maskFlightNumbers(text))) {
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

  const expected = facts.flightNumber ? normalizeFlightCode(facts.flightNumber) : null;
  for (const match of text.matchAll(FLIGHT_CODE)) {
    const code = normalizeFlightCode(match[0]);
    if (!expected) violations.push(`unexpected-flight:${match[0]}`);
    else if (code !== expected) violations.push(`wrong-flight:${match[0]}`);
  }

  return { ok: violations.length === 0, violations };
}
