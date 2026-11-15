/**
 * Jalali (Persian) calendar helpers.
 *
 * Dates travel through the app as `YYYY-MM-DD` civil-date strings so that a trip
 * on "12 آبان" never shifts because of a browser timezone. Conversion uses the
 * well-known Khayyam/Birashk-free arithmetic algorithm and is unit-tested against
 * known anchor dates.
 */

import { toPersianDigits } from "./format";

const PERSIAN_MONTHS = [
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
] as const;

const PERSIAN_WEEKDAYS = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"] as const;

export interface JalaliDate {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
}

function div(a: number, b: number): number {
  return Math.floor(a / b);
}

function mod(a: number, b: number): number {
  return a - Math.floor(a / b) * b;
}

function isGregorianLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Gregorian → Jalali (the standard arithmetic algorithm, valid for 1178–1633 Jalali).
 * Verified against anchor dates in the unit tests (1 Farvardin = 21 March).
 */
export function gregorianToJalali(gy: number, gm: number, gd: number): JalaliDate {
  const gDaysInMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  const g = gy <= 1600 ? gy - 621 : gy - 1600;
  const gy2 = gm > 2 ? g + 1 : g;
  let days =
    365 * g +
    div(gy2 + 3, 4) -
    div(gy2 + 99, 100) +
    div(gy2 + 399, 400) -
    80 +
    gd +
    (gDaysInMonth[gm - 1] ?? 0);

  jy += 33 * div(days, 12053);
  days = mod(days, 12053);
  jy += 4 * div(days, 1461);
  days = mod(days, 1461);
  if (days > 365) {
    jy += div(days - 1, 365);
    days = mod(days - 1, 365);
  }
  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + (days < 186 ? mod(days, 31) : mod(days - 186, 30));
  return { year: jy, month: jm, day: jd };
}

/** Jalali → Gregorian (inverse of `gregorianToJalali`). */
export function jalaliToGregorian(jy: number, jm: number, jd: number): { year: number; month: number; day: number } {
  let gy = jy <= 979 ? 621 : 1600;
  const j = jy <= 979 ? jy : jy - 979;
  let days =
    365 * j +
    div(j, 33) * 8 +
    div(mod(j, 33) + 3, 4) +
    78 +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);

  gy += 400 * div(days, 146097);
  days = mod(days, 146097);
  if (days > 36524) {
    days -= 1;
    gy += 100 * div(days, 36524);
    days = mod(days, 36524);
    if (days >= 365) days += 1;
  }
  gy += 4 * div(days, 1461);
  days = mod(days, 1461);
  if (days > 365) {
    gy += div(days - 1, 365);
    days = mod(days - 1, 365);
  }

  const monthLengths = [31, isGregorianLeap(gy) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gd = days + 1;
  let gm = 1;
  for (const length of monthLengths) {
    if (gd <= length) break;
    gd -= length;
    gm += 1;
  }
  return { year: gy, month: gm, day: gd };
}

export function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Invalid ISO date: ${iso}`);
  return { year: y, month: m, day: d };
}

/**
 * True only for a real civil day written `YYYY-MM-DD`.
 *
 * `2026-13-45` and `2026-02-30` are not "unknown dates", they are typos: the caller must
 * be able to say so in Persian instead of silently searching some other day.
 */
export function isValidCivilDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isoToday(now: Date = new Date()): string {
  // Civil date in Tehran: the demo is Iran-centric and this keeps server/client equal.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now);
}

export function addDays(iso: string, days: number): string {
  const { year, month, day } = parseIsoDate(iso);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function diffDays(fromIso: string, toIso: string): number {
  const a = parseIsoDate(fromIso);
  const b = parseIsoDate(toIso);
  const ta = Date.UTC(a.year, a.month - 1, a.day);
  const tb = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((tb - ta) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday (JS convention). */
export function weekdayIndex(iso: string): number {
  const { year, month, day } = parseIsoDate(iso);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isoToJalali(iso: string): JalaliDate {
  const { year, month, day } = parseIsoDate(iso);
  return gregorianToJalali(year, month, day);
}

/**
 * Strict Jalali → ISO. A day that does not exist (30 Esfand in a common year, 31 Mehr) is an
 * error, not a silent roll-over into the next month (B11).
 */
export function jalaliToIsoChecked(year: number, month: number, day: number): { ok: true; iso: string } | { ok: false; reason: string } {
  if (month < 1 || month > 12) return { ok: false, reason: "ماه شمسی باید بین ۱ و ۱۲ باشد." };
  if (!isValidJalaliDate(year, month, day)) {
    return { ok: false, reason: `روز ${day} در این ماه وجود ندارد.` };
  }
  return { ok: true, iso: jalaliToIso(year, month, day) };
}

export function jalaliToIso(year: number, month: number, day: number): string {
  const g = jalaliToGregorian(year, month, day);
  return toIsoDate(g.year, g.month, g.day);
}

export function formatJalali(iso: string, style: "short" | "long" | "weekday" = "short"): string {
  const j = isoToJalali(iso);
  const weekday = PERSIAN_WEEKDAYS[weekdayIndex(iso)] ?? "";
  const month = PERSIAN_MONTHS[j.month - 1] ?? "";
  const day = toPersianDigits(j.day);
  const year = toPersianDigits(j.year);
  if (style === "long") return `${weekday} ${day} ${month} ${year}`;
  if (style === "weekday") return weekday;
  return `${day} ${month}`;
}

export function formatJalaliFull(iso: string): string {
  return formatJalali(iso, "long");
}

export function persianMonthLabel(jy: number, jm: number): string {
  return `${PERSIAN_MONTHS[jm - 1] ?? ""} ${toPersianDigits(jy)}`;
}

/**
 * Days in a Jalali month: 31 for months 1–6, 30 for 7–11, and 29 or 30 for Esfand
 * (the leap month), measured as the real distance between 1 Esfand and 1 Farvardin.
 *
 * The old formula subtracted 334 from a 365/366-day span, which returns 31 or 32 — a
 * December-like month that does not exist in the Persian calendar (B10).
 */
export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  if (jm < 1 || jm > 12) return 0;
  const start = jalaliToGregorian(jy, 12, 1);
  const next = jalaliToGregorian(jy + 1, 1, 1);
  const days =
    (Date.UTC(next.year, next.month - 1, next.day) - Date.UTC(start.year, start.month - 1, start.day)) / 86_400_000;
  return Math.round(days);
}

/** True when `(jy, jm, jd)` is a day that exists in the Persian calendar (B11). */
export function isValidJalaliDate(jy: number, jm: number, jd: number): boolean {
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || !Number.isInteger(jd)) return false;
  if (jy < 1179 || jm < 1 || jm > 12 || jd < 1) return false;
  return jd <= jalaliMonthLength(jy, jm);
}

/** First day-of-week (0=Sun) of a Jalali month, for building a month grid. */
export function jalaliMonthStartWeekday(jy: number, jm: number): number {
  return weekdayIndex(jalaliToIso(jy, jm, 1));
}

export { PERSIAN_MONTHS, PERSIAN_WEEKDAYS };
