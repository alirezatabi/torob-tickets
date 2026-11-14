import { CITIES } from "@/lib/cities";
import { isoToday } from "@/lib/jalali";
import { completeJson, isLlmEnabled, parseJsonObject, type ChatMessage } from "./llm";
import { parseNaturalLanguage } from "./nlParser";
import { parseIntent, type ParsedIntent } from "./schema";

/**
 * Natural-language → structured intent.
 *
 * Strategy: the deterministic parser always runs first (it is the fallback and the
 * sanity check). If an LLM is configured we ask it to fill the same schema, then
 * validate with Zod and *reject* anything that fails — never partially trust it.
 */

export interface IntentResult {
  intent: ParsedIntent;
  source: "llm" | "parser";
  /** Present when the LLM path was tried and discarded, for transparency in the UI. */
  fallbackReason?: string;
  latencyMs: number;
}

export async function understandIntent(text: string, options: { today?: string } = {}): Promise<IntentResult> {
  const today = options.today ?? isoToday();
  const startedAt = Date.now();
  const baseline = parseNaturalLanguage(text, { today });

  if (!isLlmEnabled()) {
    return { intent: baseline, source: "parser", fallbackReason: "no-api-key", latencyMs: Date.now() - startedAt };
  }

  const messages = buildMessages(text, today);
  const completion = await completeJson(messages, { temperature: 0.1, timeoutMs: 8_000 });

  if (!completion) {
    return { intent: baseline, source: "parser", fallbackReason: "llm-unavailable", latencyMs: Date.now() - startedAt };
  }

  const payload = parseJsonObject(completion.text);
  const validated = parseIntent(normalizeLlmPayload(payload, baseline, today));

  if (!validated.ok) {
    return {
      intent: baseline,
      source: "parser",
      fallbackReason: `invalid-llm-output: ${validated.errors.join("; ")}`,
      latencyMs: Date.now() - startedAt,
    };
  }

  // Guardrail: if the model found a route but lost information the deterministic
  // parser is certain about (e.g. "بدون توقف"), keep the parser's hard constraints.
  const merged: ParsedIntent = {
    ...validated.intent,
    maxStops: validated.intent.maxStops ?? baseline.maxStops,
    baggageRequired: validated.intent.baggageRequired || baseline.baggageRequired,
    refundableOnly: validated.intent.refundableOnly || baseline.refundableOnly,
    departDate: validated.intent.departDate ?? baseline.departDate,
    originCode: validated.intent.originCode ?? baseline.originCode,
    destinationCode: validated.intent.destinationCode ?? baseline.destinationCode,
    missing: computeMissing({
      originCode: validated.intent.originCode ?? baseline.originCode,
      destinationCode: validated.intent.destinationCode ?? baseline.destinationCode,
      departDate: validated.intent.departDate ?? baseline.departDate,
    }),
  };

  return { intent: merged, source: "llm", latencyMs: Date.now() - startedAt };
}

function computeMissing(fields: {
  originCode: string | null;
  destinationCode: string | null;
  departDate: string | null;
}): ("origin" | "destination" | "date")[] {
  const missing: ("origin" | "destination" | "date")[] = [];
  if (!fields.originCode) missing.push("origin");
  if (!fields.destinationCode) missing.push("destination");
  if (!fields.departDate) missing.push("date");
  return missing;
}

function buildMessages(text: string, today: string): ChatMessage[] {
  const cityList = CITIES.map((c) => `${c.code} (${c.fa} / ${c.en})`).join(", ");
  return [
    {
      role: "system",
      content: [
        "You convert Persian or English travel requests into a strict JSON object for a flight search engine.",
        "Return ONLY JSON. Never invent airports, dates or preferences that are not implied by the user.",
        `Today is ${today} (Gregorian). Resolve relative dates ("فردا", "جمعه آینده") to YYYY-MM-DD.`,
        `Allowed airport codes: ${cityList}.`,
        "Schema:",
        '{"originCode": string|null, "destinationCode": string|null, "departDate": "YYYY-MM-DD"|null,',
        ' "returnDate": "YYYY-MM-DD"|null, "tripType": "oneway"|"roundtrip", "passengers": 1-9,',
        ' "cabin": "economy"|"premium"|"business", "pricePreference": "low"|"balanced"|"comfort",',
        ' "maxStops": 0-3|null, "baggageRequired": boolean, "refundableOnly": boolean,',
        ' "dayPart": "early-morning"|"morning"|"afternoon"|"evening"|"night"|null,',
        ' "maxPriceToman": number|null, "preferredAirlines": string[], "confidence": 0-1}',
        'Use null / defaults when the user did not say. "ارزان" → pricePreference "low".',
        '"بدون توقف"/"مستقیم" → maxStops 0. "با بار"/"چمدان" → baggageRequired true.',
        "If origin is not stated, leave originCode null instead of guessing.",
      ].join("\n"),
    },
    { role: "user", content: text },
  ];
}

/** Coerce loose model output into the schema's expectations before validation. */
function normalizeLlmPayload(payload: unknown, baseline: ParsedIntent, today: string): unknown {
  if (typeof payload !== "object" || payload === null) return null;
  const raw = payload as Record<string, unknown>;
  const asCode = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const upper = value.trim().toUpperCase();
    return CITIES.some((c) => c.code === upper) ? upper : null;
  };
  const asDate = (value: unknown): string | null =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;

  return {
    originCode: asCode(raw.originCode),
    destinationCode: asCode(raw.destinationCode),
    departDate: asDate(raw.departDate),
    returnDate: asDate(raw.returnDate),
    tripType: raw.tripType === "roundtrip" ? "roundtrip" : "oneway",
    passengers: typeof raw.passengers === "number" ? raw.passengers : baseline.passengers,
    cabin: raw.cabin === "business" || raw.cabin === "premium" ? raw.cabin : "economy",
    pricePreference:
      raw.pricePreference === "low" || raw.pricePreference === "comfort" ? raw.pricePreference : "balanced",
    maxStops: typeof raw.maxStops === "number" ? Math.max(0, Math.min(3, Math.round(raw.maxStops))) : null,
    baggageRequired: raw.baggageRequired === true,
    refundableOnly: raw.refundableOnly === true,
    dayPart: typeof raw.dayPart === "string" ? raw.dayPart : null,
    maxPriceToman:
      typeof raw.maxPriceToman === "number" && raw.maxPriceToman > 0 ? Math.round(raw.maxPriceToman) : null,
    preferredAirlines: Array.isArray(raw.preferredAirlines)
      ? raw.preferredAirlines.filter((a): a is string => typeof a === "string" && a.length === 2)
      : [],
    missing: [],
    confidence: typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 0.8,
    // keep today referenced for future absolute-date repair
    ...(today ? {} : {}),
  };
}
