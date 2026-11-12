import { getCity } from "./cities";
import { localToUtcIso, minutesBetween } from "./time";

/**
 * A demo "timetable" of recurring flights.
 *
 * Real airline schedules repeat weekly, so the demo dataset is defined as weekly
 * patterns and materialized for any requested date. That keeps the demo alive
 * forever (no stale fixtures) while every day still returns a different, stable
 * set of flights and prices.
 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

export interface FlightPattern {
  id: string;
  airlineCode: string;
  /** Operating flight number, stable across dates (like a real schedule). */
  flightNumber: string;
  originCode: string;
  destinationCode: string;
  /** Local departure time, minutes after midnight. */
  departMinutes: number;
  durationMinutes: number;
  days: Weekday[];
  aircraft: string;
  stops: number;
  /** Local arrival time of the intermediate stop, when `stops` > 0. */
  layoverAirport?: string;
  layoverMinutes?: number;
  /** Base price in toman for the cheapest cabin; providers mark it up/down. */
  basePriceToman: number;
  checkedBaggageKg: number | null;
  cabinBaggageKg: number | null;
  refundable: boolean | null;
  cabin: "economy" | "premium" | "business";
}

const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4];
const WEEKEND: Weekday[] = [4, 5, 6];

/** Tehran → Istanbul is the flagship demo route (many offers, providers, edge cases). */
export const FLIGHT_PATTERNS: FlightPattern[] = [
  // ——— Direct morning departures ———
  {
    id: "thr-ist-w5-0107",
    airlineCode: "W5",
    flightNumber: "W5-107",
    originCode: "THR",
    destinationCode: "IST",
    departMinutes: 7 * 60 + 15,
    durationMinutes: 195,
    days: ALL_DAYS,
    aircraft: "Airbus A310",
    stops: 0,
    basePriceToman: 4_250_000,
    checkedBaggageKg: 30,
    cabinBaggageKg: 7,
    refundable: false,
    cabin: "economy",
  },
  {
    id: "thr-ist-tk-0873",
    airlineCode: "TK",
    flightNumber: "TK-873",
    originCode: "THR",
    destinationCode: "IST",
    departMinutes: 8 * 60 + 40,
    durationMinutes: 185,
    days: ALL_DAYS,
    aircraft: "Airbus A321neo",
    stops: 0,
    basePriceToman: 5_100_000,
    checkedBaggageKg: 23,
    cabinBaggageKg: 8,
    refundable: true,
    cabin: "economy",
  },
  {
    id: "thr-ist-ir-0755",
    airlineCode: "IR",
    flightNumber: "IR-755",
    originCode: "THR",
    destinationCode: "IST",
    departMinutes: 6 * 60 + 30,
    durationMinutes: 205,
    days: [...WEEKDAYS, 6],
    aircraft: "Airbus A330",
    stops: 0,
    basePriceToman: 3_890_000,
    checkedBaggageKg: 30,
    cabinBaggageKg: 7,
    refundable: false,
    cabin: "economy",
  },
  // ——— Direct afternoon / evening ———
  {
    id: "thr-ist-b9-7390",
    airlineCode: "B9",
    flightNumber: "B9-390",
    originCode: "THR",
    destinationCode: "IST",
    departMinutes: 14 * 60 + 20,
    durationMinutes: 200,
    days: ALL_DAYS,
    aircraft: "McDonnell Douglas MD-82",
    stops: 0,
    basePriceToman: 3_650_000,
    checkedBaggageKg: null,
    cabinBaggageKg: null,
    refundable: null,
    cabin: "economy",
  },
  {
    id: "thr-ist-pc-0517",
    airlineCode: "PC",
    flightNumber: "PC-517",
    originCode: "THR",
    destinationCode: "IST",
    departMinutes: 18 * 60 + 5,
    durationMinutes: 190,
    days: ALL_DAYS,
    aircraft: "Airbus A320neo",
    stops: 0,
    basePriceToman: 3_420_000,
    checkedBaggageKg: 0,
    cabinBaggageKg: 8,
    refundable: false,
    cabin: "economy",
  },
  {
    id: "thr-ist-xq-0988",
    airlineCode: "XQ",
    flightNumber: "XQ-988",
    originCode: "THR",
    destinationCode: "IST",
    departMinutes: 22 * 60 + 35,
    durationMinutes: 195,
    days: ALL_DAYS,
    aircraft: "Boeing 737-800",
    stops: 0,
    basePriceToman: 3_180_000,
    checkedBaggageKg: 20,
    cabinBaggageKg: 8,
    refundable: false,
    cabin: "economy",
  },
  // ——— Overnight one-stop ———
  {
    id: "thr-ist-zv-5012",
    airlineCode: "ZV",
    flightNumber: "ZV-5012",
    originCode: "THR",
    destinationCode: "IST",
    departMinutes: 23 * 60 + 50,
    durationMinutes: 330,
    days: ALL_DAYS,
    aircraft: "Airbus A320",
    stops: 1,
    layoverAirport: "TBZ",
    layoverMinutes: 75,
    basePriceToman: 2_890_000,
    checkedBaggageKg: 20,
    cabinBaggageKg: 5,
    refundable: false,
    cabin: "economy",
  },
  // ——— One-stop via Dubai (business-ish offer, premium cabin) ———
  {
    id: "thr-ist-fz-0014",
    airlineCode: "FZ",
    flightNumber: "FZ-14",
    originCode: "THR",
    destinationCode: "IST",
    departMinutes: 10 * 60 + 10,
    durationMinutes: 415,
    days: [...WEEKDAYS, 6],
    aircraft: "Boeing 737 MAX 8",
    stops: 1,
    layoverAirport: "DXB",
    layoverMinutes: 110,
    basePriceToman: 4_950_000,
    checkedBaggageKg: 30,
    cabinBaggageKg: 7,
    refundable: true,
    cabin: "economy",
  },
  {
    id: "thr-ist-ek-0979",
    airlineCode: "EK",
    flightNumber: "EK-979",
    originCode: "THR",
    destinationCode: "IST",
    departMinutes: 16 * 60 + 45,
    durationMinutes: 405,
    days: ALL_DAYS,
    aircraft: "Boeing 777-300ER",
    stops: 1,
    layoverAirport: "DXB",
    layoverMinutes: 95,
    basePriceToman: 11_400_000,
    checkedBaggageKg: 35,
    cabinBaggageKg: 7,
    refundable: true,
    cabin: "business",
  },
  // ——— Two stops (the deliberately unattractive option) ———
  {
    id: "thr-ist-ep-3302",
    airlineCode: "EP",
    flightNumber: "EP-3302",
    originCode: "THR",
    destinationCode: "IST",
    departMinutes: 4 * 60 + 55,
    durationMinutes: 560,
    days: [1, 3, 5],
    aircraft: "ATR 72",
    stops: 2,
    layoverAirport: "TBZ",
    layoverMinutes: 180,
    basePriceToman: 2_760_000,
    checkedBaggageKg: 15,
    cabinBaggageKg: 5,
    refundable: false,
    cabin: "economy",
  },
  // ——— Tehran → Dubai (secondary demo route) ———
  {
    id: "thr-dxb-fz-0018",
    airlineCode: "FZ",
    flightNumber: "FZ-18",
    originCode: "THR",
    destinationCode: "DXB",
    departMinutes: 9 * 60 + 20,
    durationMinutes: 135,
    days: ALL_DAYS,
    aircraft: "Boeing 737-800",
    stops: 0,
    basePriceToman: 2_450_000,
    checkedBaggageKg: 20,
    cabinBaggageKg: 7,
    refundable: false,
    cabin: "economy",
  },
  {
    id: "thr-dxb-w5-0031",
    airlineCode: "W5",
    flightNumber: "W5-31",
    originCode: "THR",
    destinationCode: "DXB",
    departMinutes: 19 * 60 + 30,
    durationMinutes: 150,
    days: [...WEEKDAYS, 6],
    aircraft: "Airbus A310",
    stops: 0,
    basePriceToman: 2_180_000,
    checkedBaggageKg: 30,
    cabinBaggageKg: 7,
    refundable: false,
    cabin: "economy",
  },
  {
    id: "thr-dxb-ek-0975",
    airlineCode: "EK",
    flightNumber: "EK-975",
    originCode: "THR",
    destinationCode: "DXB",
    departMinutes: 12 * 60 + 15,
    durationMinutes: 140,
    days: ALL_DAYS,
    aircraft: "Airbus A380",
    stops: 0,
    basePriceToman: 4_300_000,
    checkedBaggageKg: 30,
    cabinBaggageKg: 7,
    refundable: true,
    cabin: "economy",
  },
  // ——— Mashhad (domestic) ———
  {
    id: "thr-mhd-ir-0650",
    airlineCode: "IR",
    flightNumber: "IR-650",
    originCode: "THR",
    destinationCode: "MHD",
    departMinutes: 7 * 60,
    durationMinutes: 95,
    days: ALL_DAYS,
    aircraft: "Airbus A320",
    stops: 0,
    basePriceToman: 1_850_000,
    checkedBaggageKg: 20,
    cabinBaggageKg: 7,
    refundable: false,
    cabin: "economy",
  },
  {
    id: "thr-mhd-ep-0381",
    airlineCode: "EP",
    flightNumber: "EP-381",
    originCode: "THR",
    destinationCode: "MHD",
    departMinutes: 16 * 60 + 40,
    durationMinutes: 100,
    days: ALL_DAYS,
    aircraft: "Boeing 737-400",
    stops: 0,
    basePriceToman: 1_420_000,
    checkedBaggageKg: 20,
    cabinBaggageKg: 5,
    refundable: false,
    cabin: "economy",
  },
  // ——— Frankfurt (long-haul, shows the currency/FX path) ———
  {
    id: "thr-fra-lh-0601",
    airlineCode: "LH",
    flightNumber: "LH-601",
    originCode: "THR",
    destinationCode: "FRA",
    departMinutes: 2 * 60 + 25,
    durationMinutes: 340,
    days: [...WEEKEND, 2],
    aircraft: "Airbus A340-300",
    stops: 0,
    basePriceToman: 21_500_000,
    checkedBaggageKg: 23,
    cabinBaggageKg: 8,
    refundable: true,
    cabin: "economy",
  },
  {
    id: "thr-fra-tk-0886",
    airlineCode: "TK",
    flightNumber: "TK-886",
    originCode: "THR",
    destinationCode: "FRA",
    departMinutes: 3 * 60 + 10,
    durationMinutes: 585,
    days: ALL_DAYS,
    aircraft: "Boeing 787-9",
    stops: 1,
    layoverAirport: "IST",
    layoverMinutes: 90,
    basePriceToman: 18_900_000,
    checkedBaggageKg: 23,
    cabinBaggageKg: 8,
    refundable: true,
    cabin: "economy",
  },
];

export interface MaterializedFlight {
  pattern: FlightPattern;
  departAtUtc: string;
  arriveAtUtc: string;
  durationMinutes: number;
  stops: number;
  segments: {
    airlineCode: string;
    flightNumber: string;
    originCode: string;
    destinationCode: string;
    departAt: string;
    arriveAt: string;
    aircraft: string;
  }[];
}

function dateOf(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return { y: y ?? 1970, m: m ?? 1, d: d ?? 1 };
}

/** UTC weekday index of a civil date (0 = Sunday). */
export function weekdayOfIsoDate(isoDate: string): Weekday {
  const { y, m, d } = dateOf(isoDate);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as Weekday;
}

/**
 * Materialize the pattern's segments for a concrete departure date.
 * Intermediate stops are placed proportionally so the timeline stays coherent.
 */
export function materializePattern(pattern: FlightPattern, isoDate: string): MaterializedFlight {
  const originTz = getCity(pattern.originCode)?.timezone ?? "Asia/Tehran";
  const departAt = localToUtcIso(isoDate, pattern.departMinutes, originTz);
  const arriveAt = localToUtcIso(isoDate, pattern.departMinutes + pattern.durationMinutes, originTz);

  const segments: MaterializedFlight["segments"] = [];

  if (pattern.stops === 0) {
    segments.push({
      airlineCode: pattern.airlineCode,
      flightNumber: pattern.flightNumber,
      originCode: pattern.originCode,
      destinationCode: pattern.destinationCode,
      departAt,
      arriveAt,
      aircraft: pattern.aircraft,
    });
  } else {
    const total = pattern.durationMinutes;
    const legs = pattern.stops + 1;
    const leg = Math.floor((total - (pattern.layoverMinutes ?? 60) * pattern.stops) / legs);
    const stopAirport = pattern.layoverAirport ?? "DXB";
    let cursor = departAt;
    let from = pattern.originCode;
    for (let i = 0; i < legs; i++) {
      const to = i === legs - 1 ? pattern.destinationCode : stopAirport;
      const legEnd = new Date(new Date(cursor).getTime() + leg * 60_000).toISOString();
      segments.push({
        airlineCode: pattern.airlineCode,
        flightNumber: pattern.flightNumber,
        originCode: from,
        destinationCode: to,
        departAt: cursor,
        arriveAt: legEnd,
        aircraft: pattern.aircraft,
      });
      cursor = new Date(
        new Date(legEnd).getTime() + (i === legs - 1 ? 0 : (pattern.layoverMinutes ?? 60) * 60_000),
      ).toISOString();
      from = to;
    }
  }

  // Recompute duration from the segments (never trust the fixture number).
  const realDuration = minutesBetween(departAt, arriveAt);

  return {
    pattern,
    departAtUtc: departAt,
    arriveAtUtc: arriveAt,
    durationMinutes: realDuration,
    stops: segments.length - 1,
    segments,
  };
}

/** All patterns that operate on a date for a route. */
export function patternsForRoute(originCode: string, destinationCode: string, isoDate: string): FlightPattern[] {
  const weekday = weekdayOfIsoDate(isoDate);
  return FLIGHT_PATTERNS.filter(
    (p) =>
      p.originCode === originCode.toUpperCase() &&
      p.destinationCode === destinationCode.toUpperCase() &&
      p.days.includes(weekday),
  );
}

/** Routes that have demo data, used by the homepage chips and validation. */
export function availableRoutes(): { originCode: string; destinationCode: string }[] {
  const seen = new Set<string>();
  const routes: { originCode: string; destinationCode: string }[] = [];
  for (const p of FLIGHT_PATTERNS) {
    const key = `${p.originCode}-${p.destinationCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ originCode: p.originCode, destinationCode: p.destinationCode });
  }
  return routes;
}

/** Alias used by provider adapters (keeps their imports terse). */
export const materialize = materializePattern;
