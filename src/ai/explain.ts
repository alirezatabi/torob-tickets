import type { FlightOffer } from "@/domain/flight";
import { formatDuration, formatStopsShort, formatToman } from "@/lib/format";
import { explainRecommendation } from "@/ranking/explain";
import type { RankedResult } from "@/ranking/score";
import { checkGrounding, type GroundingFacts } from "./grounding";
import { completeJson, isLlmEnabled, parseJsonObject, type ChatMessage } from "./llm";
import { ExplanationSchema } from "./schema";

/**
 * Recommendation explanation.
 *
 * The deterministic Persian sentence is always computed first and is always the
 * fallback. When an LLM is available it only rewrites the *same* facts, and the
 * rewrite passes `checkGrounding` or is thrown away.
 */

export interface ExplanationResult {
  text: string;
  source: "llm" | "template";
  rejectedReason?: string;
}

export async function explainBestOffer(offer: FlightOffer, result: RankedResult): Promise<ExplanationResult> {
  const template = explainRecommendation(offer, result);
  if (!isLlmEnabled()) return { text: template, source: "template" };

  const facts = buildLlmFacts(offer, result);
  const completion = await completeJson(buildMessages(facts), { temperature: 0.3, timeoutMs: 7_000 });
  if (!completion) return { text: template, source: "template", rejectedReason: "llm-unavailable" };

  const payload = parseJsonObject(completion.text);
  const parsed = ExplanationSchema.safeParse(payload);
  if (!parsed.success) return { text: template, source: "template", rejectedReason: "schema-mismatch" };

  const grounding = checkGrounding(parsed.data.text, toGroundingFacts(facts));
  if (!grounding.ok) {
    return { text: template, source: "template", rejectedReason: grounding.violations.join(",") };
  }

  return { text: parsed.data.text, source: "llm" };
}

export interface LlmFactPayload {
  recommended: Record<string, string | number | boolean | null>;
  alternatives: Record<string, string | number | boolean | null>[];
  userPreferences: Record<string, string | number | boolean | null>;
  deltas: { priceVsCheapestToman: number; durationVsFastestMinutes: number };
}

/** Only normalized, already-computed values go to the model. */
export function buildLlmFacts(offer: FlightOffer, result: RankedResult): LlmFactPayload {
  const cheapest = result.cheapest?.offer;
  const fastest = result.fastest?.offer;
  const alternatives = result.feasible
    .filter((s) => s.offer.id !== offer.id)
    .slice(0, 3)
    .map((s) => ({
      airline: s.offer.airlineName,
      flightNumber: s.offer.flightNumber,
      priceToman: s.offer.price.toman,
      durationMinutes: s.offer.durationMinutes,
      stops: s.offer.stops,
    }));

  return {
    recommended: {
      airline: offer.airlineName,
      flightNumber: offer.flightNumber,
      priceToman: offer.price.toman,
      durationMinutes: offer.durationMinutes,
      stops: offer.stops,
      baggageChecked: offer.baggage.checked,
      baggageKg: offer.baggage.checkedKg,
      refundable: offer.refundable,
      score: result.best?.score ?? null,
    },
    alternatives,
    userPreferences: {
      note: "weights were derived from the user's structured intent",
      cheapestToman: cheapest?.price.toman ?? null,
      fastestMinutes: fastest?.durationMinutes ?? null,
    },
    deltas: {
      priceVsCheapestToman: cheapest ? offer.price.toman - cheapest.price.toman : 0,
      durationVsFastestMinutes: fastest ? offer.durationMinutes - fastest.durationMinutes : 0,
    },
  };
}

function buildMessages(facts: LlmFactPayload): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You write ONE short Persian (Farsi) sentence pair explaining why the recommended flight is the best match.",
        "Rules:",
        "- Use ONLY the numbers and facts in the JSON payload. Never invent prices, times, baggage or providers.",
        "- Keep it under 60 Persian words, friendly and concrete.",
        "- If baggageChecked is \"unknown\", do not claim anything about baggage.",
        "- If refundable is null, do not mention refunds.",
        "- Do not mention any flight other than the recommended one by number.",
        'Return JSON only: {"text": "..."}',
        `Payload: ${JSON.stringify(facts)}`,
      ].join("\n"),
    },
    { role: "user", content: "یک توضیح کوتاه فارسی بنویس." },
  ];
}

export function toGroundingFacts(facts: LlmFactPayload): GroundingFacts {
  const recommended = facts.recommended;
  const priceToman = Number(recommended.priceToman ?? 0);
  const duration = Number(recommended.durationMinutes ?? 0);
  const baggageKg = Number(recommended.baggageKg ?? 0);
  const stops = Number(recommended.stops ?? 0);
  const score = Number(recommended.score ?? 0);

  const numbers = [
    priceToman,
    priceToman / 1_000_000,
    duration,
    Math.floor(duration / 60),
    duration % 60,
    baggageKg,
    stops,
    score,
    Math.abs(facts.deltas.priceVsCheapestToman),
    Math.abs(facts.deltas.durationVsFastestMinutes),
    Math.abs(facts.deltas.priceVsCheapestToman) / 1_000_000,
    Math.abs(facts.deltas.durationVsFastestMinutes / 60),
  ].filter((n) => Number.isFinite(n));

  for (const alternative of facts.alternatives) {
    numbers.push(Number(alternative.priceToman ?? 0), Number(alternative.durationMinutes ?? 0));
  }

  return {
    allowedNumbers: numbers,
    baggageKnown: recommended.baggageChecked !== "unknown",
    refundKnown: recommended.refundable !== null,
    allowedAirlines: [String(recommended.airline ?? "")],
    flightNumber: typeof recommended.flightNumber === "string" ? recommended.flightNumber : null,
  };
}

/** Exposed for the UI: a compact deterministic fact sheet next to the explanation. */
export function factSheet(offer: FlightOffer): { label: string; value: string }[] {
  return [
    { label: "قیمت", value: formatToman(offer.price.toman) },
    { label: "مدت سفر", value: formatDuration(offer.durationMinutes) },
    { label: "توقف", value: formatStopsShort(offer.stops) },
    { label: "منبع", value: offer.providerName },
  ];
}
