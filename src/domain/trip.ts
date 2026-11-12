/**
 * Transport-agnostic trip domain.
 *
 * Airplanes are the only implemented mode, but nothing in the search, ranking or
 * provider plumbing depends on that: a future train/bus mode only needs its own
 * segment type and adapters (see `domain/flight.ts` + `providers/`).
 */

export const TRANSPORT_MODES = ["flight", "train", "bus"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

export type TripType = "oneway" | "roundtrip";

/** Time-of-day buckets used by the intent parser and the ranking. */
export type DayPart = "early-morning" | "morning" | "afternoon" | "evening" | "night";

export const DAY_PART_LABELS: Record<DayPart, string> = {
  "early-morning": "بامداد",
  morning: "صبح",
  afternoon: "بعدازظهر",
  evening: "عصر",
  night: "شب",
};

export const DAY_PART_RANGES: Record<DayPart, [number, number]> = {
  "early-morning": [0, 6],
  morning: [6, 12],
  afternoon: [12, 17],
  evening: [17, 21],
  night: [21, 24],
};

export type CabinClass = "economy" | "premium" | "business";

export const CABIN_LABELS: Record<CabinClass, string> = {
  economy: "اقتصادی",
  premium: "پرمیوم اکونومی",
  business: "بیزینس",
};

export type PricePreference = "low" | "balanced" | "comfort";

/**
 * The user's normalized intent. Produced either by the conventional form, by the
 * deterministic Persian parser, or by the LLM — all three land in this shape and
 * are validated with the same Zod schema.
 */
export interface TripQuery {
  mode: TransportMode;
  tripType: TripType;
  originCode: string;
  destinationCode: string;
  /** ISO date, `YYYY-MM-DD`, interpreted in the origin's local calendar day. */
  departDate: string;
  returnDate: string | null;
  passengers: number;
  cabin: CabinClass;
  filters: QueryPreferences;
  /** Original natural-language text, when the search started from free text. */
  rawText?: string;
}

export interface QueryPreferences {
  pricePreference: PricePreference;
  maxStops: number | null;
  baggageRequired: boolean;
  refundableOnly: boolean;
  dayPart: DayPart | null;
  /** Inclusive upper bound in toman, when the user stated a budget. */
  maxPriceToman: number | null;
  /** Airline IATA codes the user explicitly asked for. */
  preferredAirlines: string[];
}

export const DEFAULT_PREFERENCES: QueryPreferences = {
  pricePreference: "balanced",
  maxStops: null,
  baggageRequired: false,
  refundableOnly: false,
  dayPart: null,
  maxPriceToman: null,
  preferredAirlines: [],
};

export function createQuery(input: Partial<TripQuery> & Pick<TripQuery, "originCode" | "destinationCode" | "departDate">): TripQuery {
  return {
    mode: input.mode ?? "flight",
    tripType: input.tripType ?? "oneway",
    originCode: input.originCode,
    destinationCode: input.destinationCode,
    departDate: input.departDate,
    returnDate: input.returnDate ?? null,
    passengers: input.passengers ?? 1,
    cabin: input.cabin ?? "economy",
    filters: { ...DEFAULT_PREFERENCES, ...input.filters },
    ...(input.rawText ? { rawText: input.rawText } : {}),
  };
}
