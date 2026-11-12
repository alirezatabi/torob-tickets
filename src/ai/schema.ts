import { z } from "zod";
import { CITIES } from "@/lib/cities";

const cityCodes = CITIES.map((c) => c.code) as [string, ...string[]];

/**
 * The single contract for "what the user wants".
 * Both the deterministic parser and the LLM must satisfy it; anything else is
 * rejected (and the app falls back) rather than partially trusted.
 */
export const IntentSchema = z.object({
  originCode: z.enum(cityCodes).nullable(),
  destinationCode: z.enum(cityCodes).nullable(),
  departDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .nullable(),
  returnDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
    .default(null),
  tripType: z.enum(["oneway", "roundtrip"]).default("oneway"),
  passengers: z.number().int().min(1).max(9).default(1),
  cabin: z.enum(["economy", "premium", "business"]).default("economy"),
  pricePreference: z.enum(["low", "balanced", "comfort"]).default("balanced"),
  maxStops: z.number().int().min(0).max(3).nullable().default(null),
  baggageRequired: z.boolean().default(false),
  refundableOnly: z.boolean().default(false),
  dayPart: z.enum(["early-morning", "morning", "afternoon", "evening", "night"]).nullable().default(null),
  maxPriceToman: z.number().int().positive().nullable().default(null),
  preferredAirlines: z.array(z.string().length(2)).default([]),
  /** Fields the model deliberately left empty; drives the clarification question. */
  missing: z.array(z.enum(["origin", "destination", "date"])).default([]),
  /** 0–1, set by the deterministic parser or estimated by the LLM. */
  confidence: z.number().min(0).max(1).default(0.5),
});

export type Intent = z.input<typeof IntentSchema>;
export type ParsedIntent = z.output<typeof IntentSchema>;

export const ExplanationSchema = z.object({
  /** One or two short Persian sentences, citing only provided facts. */
  text: z.string().min(10).max(420),
});

export type Explanation = z.output<typeof ExplanationSchema>;

/** Validate an unknown payload (LLM or parser output) into a trusted Intent. */
export function parseIntent(payload: unknown): { ok: true; intent: ParsedIntent } | { ok: false; errors: string[] } {
  const result = IntentSchema.safeParse(payload);
  if (!result.success) {
    return { ok: false, errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const intent = result.data;
  // Cross-field rules Zod can't express cleanly.
  if (intent.originCode && intent.destinationCode && intent.originCode === intent.destinationCode) {
    return { ok: false, errors: ["مبدأ و مقصد نمی‌توانند یکسان باشند"] };
  }
  if (intent.returnDate && intent.departDate && intent.returnDate < intent.departDate) {
    return { ok: false, errors: ["تاریخ بازگشت پیش از تاریخ رفت است"] };
  }
  return { ok: true, intent };
}
