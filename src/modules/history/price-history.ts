/**
 * Price history.
 *
 * The product promise: a chart that shows how *this exact product* changed price over
 * time — never a smoothed line through different fare conditions, and never a line
 * that starts before we actually observed anything (corrections #2 and #6).
 *
 * Consequences encoded here:
 *   • one series per `offerKey` (fare-level identity); different fare conditions are
 *     different series, even for the same flight and the same hour;
 *   • points are the raw observations, unaggregated. Where observations are sparse the
 *     chart shows a gap, not an interpolation;
 *   • every series carries `firstObservedAt` / `lastObservedAt` / `pointCount`, so the
 *     UI can say "this line starts 3 days ago";
 *   • an empty result is a *successful* answer meaning "we have no history yet",
 *     reported as such.
 */

import { getDb, isDatabaseConfigured } from "@/modules/db/prisma";
import { airportsForCity } from "@/modules/airports";
import type { PriceObservationViewRow, Where } from "@/modules/db/client-types";

export type HistoryRange = "24h" | "7d" | "30d" | "90d" | "all";

export const HISTORY_RANGE_LABELS_FA: Record<HistoryRange, string> = {
  "24h": "۲۴ ساعت",
  "7d": "۷ روز",
  "30d": "۳۰ روز",
  "90d": "۹۰ روز",
  all: "کل بازه",
};

export const HISTORY_RANGE_MS: Record<Exclude<HistoryRange, "all">, number> = {
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000,
  "90d": 90 * 24 * 60 * 60_000,
};

export interface HistoryPoint {
  observedAt: string;
  /** Integer toman. */
  priceToman: number;
  freshness: string;
  providerId: string;
}

export interface HistorySeries {
  offerKey: string;
  groupKey: string;
  providerId: string;
  airlineCode: string;
  flightNumber: string | null;
  originAirport: string | null;
  destinationAirport: string | null;
  departDate: string;
  cabin: string;
  fareClass: string | null;
  baggageSignature: string;
  ticketType: string;
  points: HistoryPoint[];
  firstObservedAt: string;
  lastObservedAt: string;
  minToman: number;
  maxToman: number;
  /** Percentage change between first and last observation, null when only one point. */
  changePct: number | null;
}

export interface HistoryResult {
  available: boolean;
  /** Persian explanation when `available` is false — shown verbatim in the UI. */
  reasonFa: string | null;
  range: HistoryRange;
  series: HistorySeries[];
  /** Total observations used (after range filtering). */
  pointCount: number;
}

export interface HistoryQuery {
  /** Scope to one route + departure date; required to avoid unbounded scans. */
  originCity?: string;
  destinationCity?: string;
  departDate?: string;
  /** Scope to a single product. */
  offerKey?: string;
  /** Scope to one flight (all its fare conditions become separate series). */
  groupKey?: string;
  range?: HistoryRange;
  maxSeries?: number;
}

const EMPTY: Omit<HistoryResult, "range"> = {
  available: false,
  reasonFa: "تاریخچه‌ای برای این پرواز ثبت نشده است",
  series: [],
  pointCount: 0,
};

export async function getPriceHistory(query: HistoryQuery): Promise<HistoryResult> {
  const range = query.range ?? "30d";

  if (!isDatabaseConfigured()) {
    return {
      ...EMPTY,
      range,
      reasonFa:
        "تاریخچهٔ قیمت به PostgreSQL نیاز دارد و در این محیط پیکربندی نشده است. برای مسیر واقعی، DATABASE_URL را تنظیم کنید.",
    };
  }
  if (!query.offerKey && !query.groupKey && !(query.originCity && query.destinationCity)) {
    // An unbounded history query would be both slow and meaningless.
    return { ...EMPTY, range, reasonFa: "برای نمایش تاریخچه، مسیر یا شناسهٔ پرواز لازم است" };
  }

  let rows: PriceObservationViewRow[];
  try {
    const db = await getDb();
    rows = await db.priceObservation.findMany({
      where: buildWhere(query, range),
      orderBy: { observedAt: "asc" },
      take: 5_000,
    });
  } catch {
    return { ...EMPTY, range, reasonFa: "خواندن تاریخچه از دیتابیس ناموفق بود" };
  }

  if (rows.length === 0) return { ...EMPTY, range };

  const seriesMap = new Map<string, HistorySeries>();
  for (const row of rows) {
    const key = `${row.providerId}:${row.offerKey}`;
    let series = seriesMap.get(key);
    if (!series) {
      series = {
        offerKey: row.offerKey,
        groupKey: row.groupKey,
        providerId: row.providerId,
        airlineCode: row.airlineCode,
        flightNumber: row.flightNumber ?? null,
        originAirport: row.originAirport ?? null,
        destinationAirport: row.destinationAirport ?? null,
        departDate: toIsoDate(row.departDate),
        cabin: row.cabin,
        fareClass: row.fareClass ?? null,
        baggageSignature: row.baggageSignature,
        ticketType: row.ticketType,
        points: [],
        firstObservedAt: row.observedAt.toISOString(),
        lastObservedAt: row.observedAt.toISOString(),
        minToman: Number(row.priceToman),
        maxToman: Number(row.priceToman),
        changePct: null,
      };
      seriesMap.set(key, series);
    }
    const price = Number(row.priceToman);
    series.points.push({
      observedAt: row.observedAt.toISOString(),
      priceToman: price,
      freshness: row.freshness,
      providerId: row.providerId,
    });
    series.lastObservedAt = row.observedAt.toISOString();
    series.minToman = Math.min(series.minToman, price);
    series.maxToman = Math.max(series.maxToman, price);
  }

  const series = [...seriesMap.values()]
    .map((entry) => {
      const first = entry.points[0]?.priceToman ?? 0;
      const last = entry.points[entry.points.length - 1]?.priceToman ?? 0;
      return {
        ...entry,
        changePct: entry.points.length > 1 && first > 0 ? Math.round(((last - first) / first) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => b.points.length - a.points.length)
    .slice(0, query.maxSeries ?? (query.offerKey ? 5_000 : query.groupKey ? 50 : 6));

  return {
    available: true,
    reasonFa: null,
    range,
    series,
    pointCount: series.reduce((total, entry) => total + entry.points.length, 0),
  };
}

function buildWhere(query: HistoryQuery, range: HistoryRange): Where {
  const where: Where = {};
  if (query.offerKey) where.offerKey = query.offerKey;
  if (query.groupKey) where.groupKey = query.groupKey;
  if (query.originCity || query.destinationCity) {
    // `routeKey` is `ORIGIN>DEST` at airport level; city-level scoping uses the
    // observation's own city columns through the offer row instead.
    if (query.originCity && query.destinationCity) {
      where.routeKey = { in: routeKeyVariants(query.originCity, query.destinationCity) };
    }
  }
  if (query.departDate) where.departDate = new Date(`${query.departDate}T00:00:00.000Z`);
  if (range !== "all") where.observedAt = { gte: new Date(Date.now() - HISTORY_RANGE_MS[range]) };
  return where;
}

/**
 * Observations store airport-level route keys (THR>MHD, IKA>IST). A city-level query
 * therefore expands to every airport pair of that city pair — using the airport
 * registry, not a guess.
 */
function routeKeyVariants(originCity: string, destinationCity: string): string[] {
  const origins = airportsOf(originCity);
  const destinations = airportsOf(destinationCity);
  const keys: string[] = [];
  for (const origin of origins) for (const destination of destinations) keys.push(`${origin}>${destination}`);
  return keys;
}

function airportsOf(cityCode: string): string[] {
  return airportsForCity(cityCode.toUpperCase());
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
