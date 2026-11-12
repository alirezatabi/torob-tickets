import { findCitiesInOrder, findCityInText } from "@/lib/cities";
import { findAirlineInText } from "@/lib/airlines";
import { addDays, isoToJalali, jalaliToIso, isoToday, weekdayIndex } from "@/lib/jalali";
import { toLatinDigits } from "@/lib/format";
import type { DayPart, PricePreference } from "@/domain/trip";
import { parseIntent, type ParsedIntent } from "./schema";

/**
 * Deterministic Persian/English intent parser.
 *
 * Why this exists: the product must work with no API key, and an LLM must never
 * be the only way to search. This parser covers the phrasings the demo uses
 * ("جمعه آینده", "فردا صبح", "بدون توقف", "با بار", "ارزان‌ترین") and returns the
 * same validated `Intent` shape as the LLM path.
 */

const PERSIAN_WEEKDAYS = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];
/** Text weekday → JS weekday index (0 = Sunday). */
const WEEKDAY_TOKENS: { tokens: string[]; index: number }[] = [
  { tokens: ["یکشنبه"], index: 0 },
  { tokens: ["دوشنبه"], index: 1 },
  { tokens: ["سه‌شنبه", "سه شنبه", "سه‌شنبه"], index: 2 },
  { tokens: ["چهارشنبه", "چهار شنبه"], index: 3 },
  { tokens: ["پنجشنبه", "پنج‌شنبه", "پنج شنبه"], index: 4 },
  { tokens: ["جمعه"], index: 5 },
  { tokens: ["شنبه"], index: 6 },
  { tokens: ["sunday"], index: 0 },
  { tokens: ["monday"], index: 1 },
  { tokens: ["tuesday"], index: 2 },
  { tokens: ["wednesday"], index: 3 },
  { tokens: ["thursday"], index: 4 },
  { tokens: ["friday"], index: 5 },
  { tokens: ["saturday"], index: 6 },
];

const DAY_PARTS: { tokens: string[]; part: DayPart }[] = [
  { tokens: ["بامداد", "سحر", "early morning", "early-morning"], part: "early-morning" },
  { tokens: ["صبح", "morning"], part: "morning" },
  { tokens: ["بعدازظهر", "بعد از ظهر", "ظهر", "afternoon"], part: "afternoon" },
  { tokens: ["عصر", "evening"], part: "evening" },
  { tokens: ["شب", "night"], part: "night" },
];

export interface ParserContext {
  /** Reference "today" (ISO civil date); injectable for tests. */
  today?: string;
}

export function parseNaturalLanguage(text: string, context: ParserContext = {}): ParsedIntent {
  const today = context.today ?? isoToday();
  const normalized = normalizeText(text);
  const missing: ("origin" | "destination" | "date")[] = [];

  // ——— Route: "از X به Y" first, then any two city mentions, then city + TO city.
  const { originCode, destinationCode } = extractRoute(normalized.text);
  if (!originCode) missing.push("origin");
  if (!destinationCode) missing.push("destination");

  // ——— Date ———
  const departDate = extractDate(normalized.text, today);
  if (!departDate) missing.push("date");

  // ——— Return date (round trip) ———
  // "رفت و برگشت" alone only switches the trip type; a return *date* needs a date
  // mention after "برگشت" ("... برگشت ۲۵ آذر").
  const roundTripHint = /رفت\s*و\s*برگشت|رفتوبرگشت|round\s*trip|return/i.test(text);
  const returnDate = roundTripHint ? extractReturnDate(normalized.text, departDate ?? today) : null;

  // ——— Stops ———
  let maxStops: number | null = null;
  if (/بدون\s*توقف|بی\s*توقف|مستقیم|direct|nonstop|non-stop/i.test(text)) maxStops = 0;
  else if (/حداکثر\s*(?:یک|۱|1)\s*توقف|یک\s*توقف|one\s*stop|1\s*stop/i.test(text)) maxStops = 1;

  // ——— Baggage ———
  const baggageRequired = /با\s*بار|چمدان|بار\s*همراه|baggage|checked\s*bag|luggage/i.test(text);

  // ——— Refundability ———
  const refundableOnly = /قابل\s*استرداد|بازگشت\s*پول|refundable|استرداد/i.test(text);

  // ——— Price preference ———
  const pricePreference: PricePreference = /ارزان|بهترین\s*قیمت|کم‌ترین\s*قیمت|cheap|budget|affordable/i.test(text)
    ? "low"
    : /راحت|رفاه|بیزینس|کلاس\s*بالا|comfort|business/i.test(text)
      ? "comfort"
      : "balanced";

  // ——— Explicit budget ———
  const maxPriceToman = extractBudget(normalized.text);

  // ——— Cabin ———
  const cabin = /بیزینس|business/i.test(text)
    ? ("business" as const)
    : /پرمیوم|premium/i.test(text)
      ? ("premium" as const)
      : ("economy" as const);

  // ——— Passengers ———
  const passengers = extractPassengers(normalized.text);

  // ——— Day part ———
  let dayPart: DayPart | null = null;
  for (const { tokens, part } of DAY_PARTS) {
    const matched = tokens.some((token) => {
      if (!/^[\x20-\x7e]+$/.test(token)) return normalized.text.includes(token);
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(normalized.text);
    });
    if (matched) {
      dayPart = part;
      break;
    }
  }

  // ——— Airline preference ———
  const airline = findAirlineInText(text, { strict: true });

  const confidence = 1 - missing.length * 0.25;

  const candidate = {
    originCode,
    destinationCode,
    departDate,
    returnDate,
    tripType: roundTripHint ? ("roundtrip" as const) : ("oneway" as const),
    passengers,
    cabin,
    pricePreference,
    maxStops,
    baggageRequired,
    refundableOnly,
    dayPart,
    maxPriceToman,
    preferredAirlines: airline ? [airline] : [],
    missing,
    confidence: Math.max(0.1, Math.min(1, confidence)),
  };

  const validated = parseIntent(candidate);
  if (validated.ok) return validated.intent;
  // Fall back to the parts that are surely valid; never return unvalidated intent.
  return {
    originCode: null,
    destinationCode: null,
    departDate: null,
    returnDate: null,
    tripType: "oneway",
    passengers: 1,
    cabin: "economy",
    pricePreference: "balanced",
    maxStops: null,
    baggageRequired: false,
    refundableOnly: false,
    dayPart: null,
    maxPriceToman: null,
    preferredAirlines: [],
    missing: ["origin", "destination", "date"],
    confidence: 0.1,
  };
}

function normalizeText(text: string): { text: string } {
  const latin = toLatinDigits(text)
    .replace(/[ي]/g, "ی")
    .replace(/[ك]/g, "ک")
    .replace(/\u200c/g, " ") // ZWNJ → space for matching
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  // Re-add no-space keyphrases handled by regexes on the original text.
  return { text: latin };
}

function extractRoute(normalized: string): { originCode: string | null; destinationCode: string | null } {
  // 1) Explicit direction: "از تهران به استانبول" / "from Tehran to Istanbul".
  //    The preposition is the source of truth — never the order of the city names.
  const fromTo =
    /(?:از|from)\s+([^\s]+(?:\s+[^\s]+)?)\s+(?:به|ب\s*سمت|تا|to|towards?)\s+([^\s]+(?:\s+[^\s]+)?)/.exec(
      normalized,
    );
  if (fromTo) {
    const origin = findCityInText(fromTo[1] ?? "");
    const destination = findCityInText(fromTo[2] ?? "");
    if (origin && destination && origin !== destination) return { originCode: origin, destinationCode: destination };
  }

  // 2) "تهران به استانبول" / "tehran to istanbul" (short form, no leading preposition).
  const toSplit = /([^\s]+)\s+(?:به|to)\s+([^\s]+)/.exec(normalized);
  if (toSplit) {
    const origin = findCityInText(toSplit[1] ?? "");
    const destination = findCityInText(toSplit[2] ?? "");
    if (origin && destination && origin !== destination) return { originCode: origin, destinationCode: destination };
  }

  // 3) No preposition at all: use the order the cities appear ("پرواز تهران استانبول").
  const mentions = findCitiesInOrder(normalized);
  if (mentions.length >= 2) {
    return { originCode: mentions[0]?.code ?? null, destinationCode: mentions[1]?.code ?? null };
  }
  if (mentions.length === 1) {
    // A single city is the destination; asking for the origin is better than guessing it.
    return { originCode: null, destinationCode: mentions[0]?.code ?? null };
  }

  return { originCode: null, destinationCode: null };
}

function extractDate(text: string, today: string): string | null {
  // Persian has no ASCII word boundaries, so tokens are matched without \b.
  if (/امروز|today/.test(text)) return today;
  // "پس فردا" must be checked before "فردا".
  if (/پس\s*فردا|day after tomorrow/.test(text)) return addDays(today, 2);
  if (/فردا|tomorrow/.test(text)) return addDays(today, 1);

  // "آخر هفته" (Iranian weekend = Thursday/Friday) → the coming Thursday.
  if (/آخر\s*هفته|weekend/.test(text)) {
    const current = weekdayIndex(today);
    const delta = (4 - current + 7) % 7 || 7;
    return addDays(today, delta);
  }

  // "هفته بعد" / "next week" → same weekday next week.
  if (/هفته\s*بعد|next\s*week/.test(text)) return addDays(today, 7);

  // "N روز دیگر" / "in N days"
  const inDays =
    /(\d+)\s*روز\s*(?:دیگر|بعد)/.exec(text) ?? /in\s*(\d+)\s*days?/.exec(text);
  if (inDays?.[1]) return addDays(today, Number(inDays[1]));

  // Weekday: "جمعه آینده", "پنجشنبه این هفته", "next friday"
  for (const { tokens, index } of WEEKDAY_TOKENS) {
    for (const token of tokens) {
      if (!text.includes(token)) continue;
      const isNext = new RegExp(`${token}\\s*(?:آینده|بعد|هفته\\s*بعد)|next\\s*${token}`, "i").test(text);
      const current = weekdayIndex(today);
      let delta = (index - current + 7) % 7;
      if (delta === 0) delta = 7; // "جمعه" said on a Friday means the next one
      if (isNext && delta < 3) delta += 7;
      return addDays(today, delta);
    }
  }

  // Jalali numeric: "۱۲ آذر", "12 آذر 1404"
  const jMonthNames = [
    "فروردین",
    "اردیبهشت",
    "خرداد",
    "تیر",
    "مرداد",
    "شهریور",
    "مهر",
    "آبان",
    "آذر",
    "دی",
    "بهمن",
    "اسفند",
  ];
  const jalaliMatch = /(\d{1,2})\s*(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)(?:\s*(\d{4}))?/.exec(
    text,
  );
  if (jalaliMatch) {
    const day = Number(jalaliMatch[1]);
    const month = jMonthNames.indexOf(jalaliMatch[2] ?? "") + 1;
    const currentJalali = isoToJalali(today);
    let year = jalaliMatch[3] ? Number(jalaliMatch[3]) : currentJalali.year;
    let iso = jalaliToIso(year, month, day);
    if (!jalaliMatch[3] && iso < today) {
      year += 1;
      iso = jalaliToIso(year, month, day);
    }
    return iso;
  }

  // ISO date
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso?.[0]) return iso[0];

  return null;
}

/**
 * Parse the return leg: "برگشت ۲۵ آذر" / "return on 2026-12-16" / "برگشت ۵ روز بعد".
 * Returns null when no date is actually stated — the UI then keeps the user's
 * chosen return date instead of inventing one.
 */
function extractReturnDate(text: string, departureIso: string): string | null {
  // "رفت و برگشت" is a trip-type phrase, not a date marker — mask it so the last
  // remaining "برگشت" is the one the user actually attached a date to.
  const masked = text.replace(/رفت\s*و\s*برگشت|رفتوبرگشت/gi, "\u0000".repeat(0));

  const marker = /(?:برگشت|بازگشت|return(?:ing)?|back)\s*(?:در|on|:)?\s*(.{0,24})/i;
  let tail = marker.exec(masked)?.[1]?.trim() ?? "";
  if (!tail) return null;

  // Use the *last* return marker: "… ۲۰ آذر برگشت ۲۵ آذر" must read "۲۵ آذر".
  const all = [...masked.matchAll(/(?:برگشت|بازگشت|return(?:ing)?)\s*(?:در|on|:)?\s*(.{0,24})/gi)];
  if (all.length > 1) tail = all[all.length - 1]?.[1]?.trim() ?? tail;
  if (!tail) return null;

  // Reuse the absolute-date parser on the tail only, so "فردا" in the outbound part
  // cannot be mistaken for the return date.
  const absolute = extractDate(tail, departureIso);
  if (absolute && absolute !== departureIso) return absolute;
  if (absolute && absolute === departureIso) {
    // "رفت و برگشت ... ۲۰ آذر" states one date for both legs; the return leg is open.
    const plusNights = /(\d+)\s*(?:شب|nights?)/.exec(text);
    if (plusNights?.[1]) return addDays(departureIso, Number(plusNights[1]));
    return null;
  }

  // "برگشت ۵ روز بعد" / "5 days later"
  const relative = /(\d+)\s*(?:روز|days?)\s*(?:بعد|later)?/.exec(tail);
  if (relative?.[1]) return addDays(departureIso, Number(relative[1]));

  return null;
}

function extractBudget(text: string): number | null {
  // "زیر ۵ میلیون", "حداکثر 3.5 میلیون تومان", "under 4,000,000"
  const million = /(?:زیر|کمتر از|حداکثر|تا|under|below|max)\s*(\d+(?:\.\d+)?)\s*میلیون/.exec(text);
  if (million?.[1]) return Math.round(Number(million[1]) * 1_000_000);

  const toman = /(?:زیر|کمتر از|حداکثر|تا|under|below|max)\s*([\d,]{6,})\s*(?:تومان|toman)?/.exec(text);
  if (toman?.[1]) {
    const value = Number(toman[1].replace(/,/g, ""));
    if (Number.isFinite(value) && value >= 100_000) return value;
  }
  return null;
}

function extractPassengers(text: string): number {
  const digit = /(\d)\s*(?:نفر|مسافر|passenger|adult)/.exec(text);
  if (digit?.[1]) return Math.min(9, Math.max(1, Number(digit[1])));
  const words: [RegExp, number][] = [
    [/\b(?:دو|2)\s*نفر/, 2],
    [/\bسه\s*نفر/, 3],
    [/\bچهار\s*نفر/, 4],
  ];
  for (const [pattern, count] of words) if (pattern.test(text)) return count;
  return 1;
}

/** The question shown when essential fields are missing. */
export function clarificationQuestion(missing: ("origin" | "destination" | "date")[]): string | null {
  if (missing.length === 0) return null;
  const labels = missing.map((m) => (m === "origin" ? "مبدأ" : m === "destination" ? "مقصد" : "تاریخ پرواز"));
  return `برای جستجو به ${labels.join(" و ")} نیاز دارم. می‌توانید در فرم زیر تکمیل کنید.`;
}

export { PERSIAN_WEEKDAYS };
