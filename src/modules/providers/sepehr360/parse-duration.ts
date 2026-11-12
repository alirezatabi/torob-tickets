/**
 * Persian duration parsing for Sepehr360.
 *
 * The page prints "۱ ساعت و ۳۰ دقیقه" (sometimes "2 ساعت", sometimes "۴۵ دقیقه",
 * frequently **nothing at all** for some carriers). An empty duration is *unknown*:
 * the caller may compute it from departure/arrival (arithmetic, and flagged as
 * inferred) but must not invent a number.
 */

import { normalizeDigits } from "@/modules/money/price";

export interface ParsedDuration {
  minutes: number;
  /** Which words were recognised — useful when the site changes wording. */
  matched: "hm" | "h" | "m" | "hm-latin";
}

export function parsePersianDuration(text: string | null | undefined): ParsedDuration | null {
  if (!text) return null;
  const normalized = normalizeDigits(text);

  const hourMatch = /(\d+)\s*(?:ساعت|ساعته|hour|hr|h)/i.exec(normalized);
  const minuteMatch = /(\d+)\s*(?:دقیقه|دقيقه|min|m\b)/i.exec(normalized);

  const hours = hourMatch ? Number(hourMatch[1]) : null;
  const minutes = minuteMatch ? Number(minuteMatch[1]) : null;

  if (hours !== null && minutes !== null) return { minutes: hours * 60 + minutes, matched: "hm" };
  if (hours !== null) return { minutes: hours * 60, matched: "h" };
  if (minutes !== null) return { minutes, matched: "m" };

  // Last resort: a bare "1:30" clock-style duration.
  const clock = /(\d{1,2}):(\d{2})/.exec(normalized);
  if (clock) return { minutes: Number(clock[1]) * 60 + Number(clock[2]), matched: "hm-latin" };

  return null;
}

/** "05:30" → minutes since midnight; `null` when the text is not a wall clock. */
export function parseWallClock(text: string | null | undefined): number | null {
  if (!text) return null;
  const normalized = normalizeDigits(text);
  const match = /(\d{1,2}):(\d{2})/.exec(normalized);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** "مستقیم" → 0, "یک توقف" → 1, "۲ توقف" → 2. Unknown wording → null. */
export function parseStops(text: string | null | undefined): number | null {
  if (!text) return null;
  const normalized = normalizeDigits(text);
  if (/مستقیم|بدون توقف|direct|nonstop/i.test(normalized)) return 0;
  const digit = /(\d+)\s*(?:توقف|stop)/i.exec(normalized);
  if (digit) return Number(digit[1]);
  if (/یک\s*توقف|one\s*stop|1\s*stop/i.test(normalized)) return 1;
  if (/دو\s*توقف|two\s*stop/i.test(normalized)) return 2;
  if (/توقف/.test(normalized)) return 1; // "with a stop", count unstated → minimum truthful value
  return null;
}
