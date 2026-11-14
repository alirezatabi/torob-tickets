/**
 * Persian formatting helpers: digits, money, durations, times.
 * All user-visible numbers go through these so the UI is consistently fa-IR.
 */

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function toPersianDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)] ?? d);
}

export function toLatinDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

/** Group thousands with the Persian thousands separator (U+066C). */
function groupLatin(value: number): string {
  const rounded = Math.round(value);
  const s = Math.abs(rounded).toString();
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += "٬";
    out += s[i];
  }
  return (rounded < 0 ? "-" : "") + out;
}

export function formatNumber(value: number): string {
  return toPersianDigits(groupLatin(value));
}

/** Price in toman, e.g. ۴٬۲۵۰٬۰۰۰ تومان */
export function formatToman(toman: number): string {
  return `${formatNumber(toman)} تومان`;
}

/** Compact price for tight spaces: ۴٫۲ میلیون تومان */
export function formatTomanCompact(toman: number): string {
  if (toman >= 1_000_000) {
    const millions = toman / 1_000_000;
    const text =
      millions >= 100
        ? String(Math.round(millions))
        : millions >= 10
          ? millions.toFixed(1).replace(/\.0$/, "")
          : millions.toFixed(2).replace(/0$/, "").replace(/\.$/, "");
    return `${toPersianDigits(text.replace(".", "٫"))} میلیون تومان`;
  }
  if (toman >= 1_000) {
    const thousands = Math.round(toman / 1_000);
    return `${formatNumber(thousands)} هزار تومان`;
  }
  return formatToman(toman);
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${toPersianDigits(m)} دقیقه`;
  if (m === 0) return `${toPersianDigits(h)} ساعت`;
  return `${toPersianDigits(h)} ساعت و ${toPersianDigits(m)} دقیقه`;
}

export function formatDurationShort(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${toPersianDigits(h)}:${toPersianDigits(String(m).padStart(2, "0"))}`;
}

/** Local wall-clock time of a UTC instant in a given IANA timezone. */
export function timeInZone(isoUtc: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(isoUtc));
}

export function formatTimeInZone(isoUtc: string, timeZone: string): string {
  return toPersianDigits(timeInZone(isoUtc, timeZone));
}

/** Civil date (YYYY-MM-DD) of a UTC instant in a given IANA timezone. */
export function isoDateInZone(isoUtc: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoUtc));
}

/** Hour (0–23) of a UTC instant in a given IANA timezone. */
export function hourInZone(isoUtc: string, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false });
  return Number(fmt.format(new Date(isoUtc)));
}

export function formatStops(stops: number): string {
  if (stops === 0) return "بدون توقف";
  if (stops === 1) return "۱ توقف";
  return `${toPersianDigits(stops)} توقف`;
}

export function formatStopsShort(stops: number): string {
  return stops === 0 ? "مستقیم" : `${toPersianDigits(stops)} توقف`;
}

export function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

/** "۲ ساعت پیش" style relative time, using the current clock. */
export function formatRelative(isoUtc: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(isoUtc).getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60_000));
  if (minutes < 1) return "همین حالا";
  if (minutes < 60) return `${toPersianDigits(minutes)} دقیقه پیش`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${toPersianDigits(hours)} ساعت پیش`;
  const days = Math.round(hours / 24);
  return `${toPersianDigits(days)} روز پیش`;
}
