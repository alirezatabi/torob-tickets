/**
 * Timezone-safe helpers.
 *
 * Travel data is inherently timezone-sensitive: a provider may send local wall
 * clock ("2026-11-20 08:30" in Tehran) while our model wants UTC instants.
 * These helpers convert between the two using `Intl`, so no offset table has to
 * be maintained by hand and DST is handled by the platform.
 */

/** Offset of `timeZone` at the given instant, in minutes (east positive). */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return (asUtc - instant.getTime()) / 60_000;
}

/**
 * Convert a local wall-clock time in `timeZone` to a UTC ISO string.
 * `minutes` is minutes after local midnight of `dateIso` (may exceed 1440 for
 * overnight flights).
 */
export function localToUtcIso(dateIso: string, minutes: number, timeZone: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const base = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0);
  const naive = new Date(base + minutes * 60_000);
  // Guess with the offset of the naive instant, then correct once for DST edges.
  let offset = zoneOffsetMinutes(naive, timeZone);
  let utc = new Date(naive.getTime() - offset * 60_000);
  const offset2 = zoneOffsetMinutes(utc, timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    utc = new Date(naive.getTime() - offset * 60_000);
  }
  return utc.toISOString();
}

/** Add minutes to a UTC instant and return ISO. */
export function addMinutesIso(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

/** Whole minutes between two ISO instants (always non-negative for flight legs). */
export function minutesBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000));
}

/** Wall-clock parts of an instant in a timezone, as `YYYY-MM-DD` + `HH:MM`. */
export function wallClockInZone(iso: string, timeZone: string): { date: string; time: string } {
  const formatted = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
  const [date, time] = formatted.split(" ");
  return { date: date ?? iso.slice(0, 10), time: time ?? "00:00" };
}

/**
 * The civil day **at the departure airport** for a UTC instant.
 *
 * "The day the user flies" is a local fact, not a UTC one: a 00:30 Tehran departure is
 * still *yesterday* in UTC (UTC+3:30 = 21:00 the day before). Every place that buckets,
 * groups, links or filters by "day" must use this, never `iso.slice(0, 10)`.
 */
export function localDepartDate(isoUtc: string, timeZone: string, fallbackIsoDate?: string): string {
  if (!isoUtc) return fallbackIsoDate ?? "";
  const date = wallClockInZone(isoUtc, timeZone).date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return fallbackIsoDate ?? isoUtc.slice(0, 10);
}

/** `HH:MM` wall clock at the departure airport, for links that must quote local time. */
export function localDepartTime(isoUtc: string, timeZone: string): string {
  return wallClockInZone(isoUtc, timeZone).time;
}

/** Deterministic 32-bit FNV-1a hash, used for stable demo price jitter. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic number in [0, 1) derived from the input string. */
export function seededUnit(input: string): number {
  // 2**32, not 0xffffffff: the hash space is 0 .. 2**32-1, so the result is [0, 1).
  return hashString(input) / 0x100000000;
}
