import { findCityInText } from "@/lib/cities";
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
  const { originCode, destinationCode } = extractRoute(normalized.text, text);
  if (!originCode) missing.push("origin");
  if (!destinationCode) missing.push("destination");

  // ——— Date ———
  const departDate = extractDate(normalized.text, today);
  if (!departDate) missing.push("date");

  // ——— Return date (round trip) ———
  const returnDate = /رفت\s*و\s*برگشت|رفتوبرگشت|round\s*trip|return/i.test(text)
    ? extractReturnDate(normalized.text, departDate ?? today)
    : null;

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
    if (tokens.some((t) => normalized.text.includes(t))) {
      dayPart = part;
      break;
    }
  }

  // ——— Airline preference ———
  const airline = findAirlineInText(text);

  const confidence = 1 - missing.length * 0.25;

  const candidate = {
    originCode,
    destinationCode,
    departDate,
    returnDate,
    tripType: returnDate ? ("roundtrip" as const) : ("oneway" as const),
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

function extractRoute(normalized: string, original: string): { originCode: string | null; destinationCode: string | null } {
  // "از تهران به استانبول"
  const fromTo = /از\s+([^\s]+(?:\s+[^\s]+)?)\s+(?:به|تا|ب\s*سمت)\s+([^\s]+(?:\s+[^\s]+)?)/.exec(normalized);
  if (fromTo) {
    const origin = findCityInText(fromTo[1] ?? "");
    const dest = findCityInText(fromTo[2] ?? "");
    if (origin && dest) return { originCode: origin, destinationCode: dest };
  }

  // "تهران به استانبول" / "tehran to istanbul"
  const toSplit = /([^\s]+)\s+(?:به|to)\s+([^\s]+)/.exec(normalized);
  if (toSplit) {
    const origin = findCityInText(toSplit[1] ?? "");
    const dest = findCityInText(toSplit[2] ?? "");
    if (origin && dest && origin !== dest) return { originCode: origin, destinationCode: dest };
  }

  // Otherwise: collect distinct city mentions in order of appearance (longest first).
  const mentions: { code: string; at: number }[] = [];
  for (const candidate of collectCityMentions(normalized)) mentions.push(candidate);
  mentions.sort((a, b) => a.at - b.at);
  const distinct: string[] = [];
  for (const mention of mentions) {
    if (!distinct.includes(mention.code)) distinct.push(mention.code);
  }
  if (distinct.length >= 2) return { originCode: distinct[0] ?? null, destinationCode: distinct[1] ?? null };
  if (distinct.length === 1) {
    // One city only: assume it is the destination from Tehran, and flag origin as missing later.
    const code = distinct[0] ?? null;
    return { originCode: null, destinationCode: code };
  }
  void original;
  return { originCode: null, destinationCode: null };
}

function collectCityMentions(text: string): { code: string; at: number }[] {
  const out: { code: string; at: number }[] = [];
  const probe = text;
  let index = 0;
  while (index < probe.length) {
    const slice = probe.slice(index, index + 40);
    const city = findCityInText(slice.slice(0, 20));
    if (city) {
      out.push({ code: city, at: index });
      index += 6;
    } else {
      index += 1;
    }
  }
  return out;
}

function extractDate(text: string, today: string): string | null {
  // Persian has no ASCII word boundaries, so tokens are matched without \b.
  if (/امروز|today/.test(text)) return today;
  // "پس فردا" must be checked before "فردا".
  if (/پس\s*فردا|day after tomorrow/.test(text)) return addDays(today, 2);
  if (/فردا|tomorrow/.test(text)) return addDays(today, 1);

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

function extractReturnDate(text: string, fallbackDate: string): string | null {
  const match = /(?:برگشت|بازگشت|return)[^\d]{0,12}(\d{1,2})/.exec(text);
  if (match?.[1]) return addDays(fallbackDate, Number(match[1]));
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
