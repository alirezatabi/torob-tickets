import { getCity } from "./cities";
import { localToUtcIso, minutesBetween } from "./time";
import { seededUnit } from "./time";

/**
 * A demo "timetable" of recurring flights.
 *
 * Real airline schedules repeat weekly, so the demo dataset is defined as weekly
 * patterns and materialized for any requested date. That keeps the demo alive
 * forever (no stale fixtures) while every day still returns a different, stable
 * set of flights and prices.
 *
 * Coverage is intentionally broad: Iranian domestic routes (the ones people
 * actually search), outbound regional routes from Tehran, and long-haul Europe.
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
  layoverAirport?: string;
  layoverMinutes?: number;
  /** Base price in toman for the cheapest cabin; providers mark it up/down. */
  basePriceToman: number;
  checkedBaggageKg: number | null;
  cabinBaggageKg: number | null;
  refundable: boolean | null;
  cabin: "economy" | "premium" | "business";
}

const ALL: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4];
const WEEKEND: Weekday[] = [4, 5, 6];

interface LegSpec {
  airlineCode: string;
  number: number;
  /** Local departure time "HH:MM" at the origin. */
  depart: string;
  minutes: number;
  aircraft: string;
  /** Base economy fare in toman. */
  price: number;
  checkedKg: number | null;
  cabinKg: number | null;
  refundable: boolean | null;
  days?: Weekday[];
  stops?: number;
  via?: string;
  layover?: number;
  cabin?: "economy" | "premium" | "business";
}

interface RouteSpec {
  from: string;
  to: string;
  legs: LegSpec[];
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Build deterministic pattern ids so prices and dedupe stay stable per flight. */
function patternId(from: string, to: string, airline: string, number: string | number): string {
  return `${from}-${to}-${airline}-${number}`.toLowerCase();
}

/** A single daily rotation, repeated across `days`. */
function daily(spec: LegSpec): LegSpec[] {
  return [{ ...spec, days: spec.days ?? ALL }];
}

const IRAN_HUBS = ["MHD", "SYZ", "IFN", "TBZ", "KIH", "AWZ", "BND", "GSM", "RAS", "KER", "ZAH", "OMH", "AZD"];

const DOMESTIC_FARES: Record<string, { minutes: number; price: number; airline: string; number: number }> = {
  MHD: { minutes: 95, price: 1_850_000, airline: "IR", number: 650 },
  SYZ: { minutes: 105, price: 1_950_000, airline: "EP", number: 381 },
  IFN: { minutes: 75, price: 1_420_000, airline: "IR", number: 330 },
  TBZ: { minutes: 85, price: 1_380_000, airline: "B9", number: 261 },
  KIH: { minutes: 130, price: 2_350_000, airline: "W5", number: 341 },
  AWZ: { minutes: 90, price: 1_560_000, airline: "ZV", number: 611 },
  BND: { minutes: 140, price: 2_150_000, airline: "EP", number: 723 },
  GSM: { minutes: 145, price: 2_250_000, airline: "W5", number: 451 },
  RAS: { minutes: 70, price: 1_320_000, airline: "B9", number: 512 },
  KER: { minutes: 110, price: 1_680_000, airline: "IR", number: 271 },
  ZAH: { minutes: 125, price: 1_790_000, airline: "EP", number: 441 },
  OMH: { minutes: 100, price: 1_610_000, airline: "ZV", number: 301 },
  AZD: { minutes: 80, price: 1_450_000, airline: "B9", number: 190 },
};

/** Tehran ⇄ each Iranian hub, two rotations a day, plus the reverse direction. */
function domesticRoutes(): RouteSpec[] {
  const routes: RouteSpec[] = [];
  for (const hub of IRAN_HUBS) {
    const spec = DOMESTIC_FARES[hub];
    if (!spec) continue;
    routes.push({
      from: "THR",
      to: hub,
      legs: [
        {
          airlineCode: spec.airline,
          number: spec.number,
          depart: "07:00",
          minutes: spec.minutes,
          aircraft: "Airbus A320",
          price: spec.price,
          checkedKg: 20,
          cabinKg: 7,
          refundable: false,
        },
        {
          airlineCode: spec.airline === "IR" ? "EP" : "IR",
          number: spec.number + 1,
          depart: "16:40",
          minutes: spec.minutes + 5,
          aircraft: "Boeing 737-400",
          price: Math.round(spec.price * 0.88),
          checkedKg: 20,
          cabinKg: 5,
          refundable: false,
        },
        {
          airlineCode: "ZV",
          number: spec.number + 2,
          depart: "21:20",
          minutes: spec.minutes + 10,
          aircraft: "ATR 72",
          price: Math.round(spec.price * 0.79),
          checkedKg: 15,
          cabinKg: 5,
          refundable: false,
          days: WEEKEND,
        },
      ],
    });
    // Return leg, so any domestic search direction has results.
    routes.push({
      from: hub,
      to: "THR",
      legs: [
        {
          airlineCode: spec.airline,
          number: spec.number + 10,
          depart: "09:15",
          minutes: spec.minutes,
          aircraft: "Airbus A320",
          price: spec.price,
          checkedKg: 20,
          cabinKg: 7,
          refundable: false,
        },
        {
          airlineCode: "IR",
          number: spec.number + 11,
          depart: "19:05",
          minutes: spec.minutes + 5,
          aircraft: "Airbus A319",
          price: Math.round(spec.price * 0.93),
          checkedKg: 20,
          cabinKg: 7,
          refundable: false,
        },
      ],
    });
  }
  return routes;
}

const REGIONAL: RouteSpec[] = [
  // ——— Istanbul: the flagship demo route ———
  {
    from: "THR",
    to: "IST",
    legs: [
      { airlineCode: "W5", number: 107, depart: "07:15", minutes: 195, aircraft: "Airbus A310", price: 4_250_000, checkedKg: 30, cabinKg: 7, refundable: false },
      { airlineCode: "TK", number: 873, depart: "08:40", minutes: 185, aircraft: "Airbus A321neo", price: 5_100_000, checkedKg: 23, cabinKg: 8, refundable: true },
      { airlineCode: "IR", number: 755, depart: "06:30", minutes: 205, aircraft: "Airbus A330", price: 3_890_000, checkedKg: 30, cabinKg: 7, refundable: false, days: [...WEEKDAYS, 6] },
      { airlineCode: "B9", number: 390, depart: "14:20", minutes: 200, aircraft: "MD-82", price: 3_650_000, checkedKg: null, cabinKg: null, refundable: null },
      { airlineCode: "PC", number: 517, depart: "18:05", minutes: 190, aircraft: "Airbus A320neo", price: 3_420_000, checkedKg: 0, cabinKg: 8, refundable: false },
      { airlineCode: "XQ", number: 988, depart: "22:35", minutes: 195, aircraft: "Boeing 737-800", price: 3_180_000, checkedKg: 20, cabinKg: 8, refundable: false },
      { airlineCode: "ZV", number: 5012, depart: "23:50", minutes: 330, aircraft: "Airbus A320", price: 2_890_000, checkedKg: 20, cabinKg: 5, refundable: false, stops: 1, via: "TBZ", layover: 75 },
      { airlineCode: "FZ", number: 14, depart: "10:10", minutes: 415, aircraft: "Boeing 737 MAX 8", price: 4_950_000, checkedKg: 30, cabinKg: 7, refundable: true, stops: 1, via: "DXB", layover: 110, days: [...WEEKDAYS, 6] },
      { airlineCode: "EK", number: 979, depart: "16:45", minutes: 405, aircraft: "Boeing 777-300ER", price: 11_400_000, checkedKg: 35, cabinKg: 7, refundable: true, stops: 1, via: "DXB", layover: 95, cabin: "business" },
      { airlineCode: "EP", number: 3302, depart: "04:55", minutes: 560, aircraft: "ATR 72", price: 2_760_000, checkedKg: 15, cabinKg: 5, refundable: false, stops: 2, via: "TBZ", layover: 150, days: [1, 3, 5] },
    ],
  },
  {
    from: "IST",
    to: "THR",
    legs: [
      { airlineCode: "TK", number: 874, depart: "11:20", minutes: 190, aircraft: "Airbus A321neo", price: 5_250_000, checkedKg: 23, cabinKg: 8, refundable: true },
      { airlineCode: "W5", number: 108, depart: "12:45", minutes: 195, aircraft: "Airbus A310", price: 4_100_000, checkedKg: 30, cabinKg: 7, refundable: false },
      { airlineCode: "PC", number: 518, depart: "23:10", minutes: 190, aircraft: "Airbus A320neo", price: 3_280_000, checkedKg: 0, cabinKg: 8, refundable: false },
    ],
  },
  // ——— Dubai / Sharjah ———
  {
    from: "THR",
    to: "DXB",
    legs: [
      { airlineCode: "FZ", number: 18, depart: "09:20", minutes: 135, aircraft: "Boeing 737-800", price: 2_450_000, checkedKg: 20, cabinKg: 7, refundable: false },
      { airlineCode: "W5", number: 31, depart: "19:30", minutes: 150, aircraft: "Airbus A310", price: 2_180_000, checkedKg: 30, cabinKg: 7, refundable: false, days: [...WEEKDAYS, 6] },
      { airlineCode: "EK", number: 975, depart: "12:15", minutes: 140, aircraft: "Airbus A380", price: 4_300_000, checkedKg: 30, cabinKg: 7, refundable: true },
      { airlineCode: "B9", number: 712, depart: "22:05", minutes: 145, aircraft: "Airbus A320", price: 1_980_000, checkedKg: null, cabinKg: null, refundable: null, days: WEEKEND },
    ],
  },
  {
    from: "DXB",
    to: "THR",
    legs: [
      { airlineCode: "FZ", number: 19, depart: "13:05", minutes: 130, aircraft: "Boeing 737-800", price: 2_390_000, checkedKg: 20, cabinKg: 7, refundable: false },
      { airlineCode: "EK", number: 976, depart: "16:40", minutes: 140, aircraft: "Airbus A380", price: 4_150_000, checkedKg: 30, cabinKg: 7, refundable: true },
    ],
  },
  {
    from: "THR",
    to: "SHJ",
    legs: daily({ airlineCode: "G9", number: 511, depart: "08:05", minutes: 140, aircraft: "Airbus A320", price: 2_050_000, checkedKg: 20, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "DOH",
    legs: daily({ airlineCode: "QR", number: 499, depart: "05:35", minutes: 165, aircraft: "Boeing 787-8", price: 5_900_000, checkedKg: 30, cabinKg: 7, refundable: true }),
  },
  {
    from: "THR",
    to: "MCT",
    legs: daily({ airlineCode: "WY", number: 341, depart: "10:20", minutes: 150, aircraft: "Boeing 737-900", price: 3_750_000, checkedKg: 30, cabinKg: 7, refundable: true }),
  },
  {
    from: "THR",
    to: "KWI",
    legs: daily({ airlineCode: "J9", number: 202, depart: "14:50", minutes: 130, aircraft: "Airbus A320", price: 3_120_000, checkedKg: 20, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "NJF",
    legs: [
      { airlineCode: "IR", number: 671, depart: "06:10", minutes: 115, aircraft: "Airbus A320", price: 2_480_000, checkedKg: 30, cabinKg: 7, refundable: false, days: [...ALL] },
      { airlineCode: "W5", number: 121, depart: "15:25", minutes: 110, aircraft: "Airbus A310", price: 2_150_000, checkedKg: 30, cabinKg: 7, refundable: false, days: [0, 1, 2, 3, 4, 5] },
      { airlineCode: "ZV", number: 806, depart: "23:15", minutes: 120, aircraft: "Airbus A320", price: 1_950_000, checkedKg: 15, cabinKg: 5, refundable: false, days: WEEKEND },
    ],
  },
  {
    from: "THR",
    to: "BGW",
    legs: daily({ airlineCode: "IR", number: 663, depart: "07:45", minutes: 130, aircraft: "Airbus A320", price: 2_320_000, checkedKg: 30, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "EVN",
    legs: daily({ airlineCode: "W5", number: 73, depart: "11:30", minutes: 100, aircraft: "Airbus A320", price: 2_650_000, checkedKg: 30, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "TBS",
    legs: daily({ airlineCode: "ZV", number: 902, depart: "09:50", minutes: 115, aircraft: "Airbus A320", price: 2_950_000, checkedKg: 20, cabinKg: 5, refundable: false }),
  },
  {
    from: "THR",
    to: "AYT",
    legs: daily({ airlineCode: "XQ", number: 721, depart: "17:40", minutes: 210, aircraft: "Boeing 737-800", price: 3_980_000, checkedKg: 20, cabinKg: 8, refundable: false }),
  },
  {
    from: "THR",
    to: "ADB",
    legs: daily({ airlineCode: "XQ", number: 545, depart: "20:10", minutes: 195, aircraft: "Boeing 737-800", price: 3_760_000, checkedKg: 20, cabinKg: 8, refundable: false }),
  },
  {
    from: "THR",
    to: "DEL",
    legs: daily({ airlineCode: "W5", number: 91, depart: "01:40", minutes: 245, aircraft: "Airbus A310", price: 6_200_000, checkedKg: 30, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "BOM",
    legs: daily({ airlineCode: "IR", number: 801, depart: "02:25", minutes: 260, aircraft: "Airbus A330", price: 6_850_000, checkedKg: 30, cabinKg: 7, refundable: false }),
  },
  // ——— Europe ———
  // ——— remaining hubs, so every city in the picker returns results ———
  {
    from: "THR",
    to: "SAW",
    legs: [
      { airlineCode: "PC", number: 521, depart: "13:10", minutes: 185, aircraft: "Airbus A320neo", price: 3_150_000, checkedKg: 0, cabinKg: 8, refundable: false },
      { airlineCode: "TK", number: 879, depart: "21:40", minutes: 190, aircraft: "Boeing 737-900", price: 4_450_000, checkedKg: 20, cabinKg: 8, refundable: true, days: [...WEEKDAYS, 6] },
    ],
  },
  {
    from: "THR",
    to: "RUH",
    legs: daily({ airlineCode: "IR", number: 651, depart: "15:30", minutes: 195, aircraft: "Airbus A320", price: 3_980_000, checkedKg: 30, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "JED",
    legs: daily({ airlineCode: "W5", number: 115, depart: "04:20", minutes: 230, aircraft: "Airbus A310", price: 4_520_000, checkedKg: 30, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "KIK",
    legs: daily({ airlineCode: "ZV", number: 811, depart: "12:05", minutes: 125, aircraft: "Airbus A320", price: 2_120_000, checkedKg: 15, cabinKg: 5, refundable: false }),
  },
  {
    from: "THR",
    to: "DAM",
    legs: daily({ airlineCode: "IR", number: 691, depart: "08:25", minutes: 145, aircraft: "Airbus A320", price: 2_760_000, checkedKg: 30, cabinKg: 7, refundable: false, days: [...WEEKDAYS, 6] }),
  },
  {
    from: "THR",
    to: "BEY",
    legs: daily({ airlineCode: "W5", number: 141, depart: "19:55", minutes: 165, aircraft: "Airbus A320", price: 3_040_000, checkedKg: 30, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "GYD",
    legs: daily({ airlineCode: "ZV", number: 921, depart: "16:35", minutes: 90, aircraft: "Airbus A320", price: 2_180_000, checkedKg: 15, cabinKg: 5, refundable: false }),
  },
  {
    from: "THR",
    to: "ASB",
    legs: daily({ airlineCode: "IR", number: 781, depart: "10:45", minutes: 100, aircraft: "Airbus A319", price: 1_980_000, checkedKg: 30, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "TAS",
    legs: daily({ airlineCode: "IR", number: 761, depart: "03:15", minutes: 185, aircraft: "Airbus A320", price: 3_460_000, checkedKg: 30, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "KHI",
    legs: daily({ airlineCode: "W5", number: 205, depart: "05:50", minutes: 180, aircraft: "Airbus A310", price: 3_020_000, checkedKg: 30, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "FRA",
    legs: [
      { airlineCode: "LH", number: 601, depart: "02:25", minutes: 340, aircraft: "Airbus A340-300", price: 21_500_000, checkedKg: 23, cabinKg: 8, refundable: true, days: [...WEEKEND, 2] },
      { airlineCode: "TK", number: 886, depart: "03:10", minutes: 585, aircraft: "Boeing 787-9", price: 18_900_000, checkedKg: 23, cabinKg: 8, refundable: true, stops: 1, via: "IST", layover: 90 },
    ],
  },
  {
    from: "THR",
    to: "MUC",
    legs: daily({ airlineCode: "LH", number: 639, depart: "02:05", minutes: 320, aircraft: "Airbus A330-300", price: 19_800_000, checkedKg: 23, cabinKg: 8, refundable: true }),
  },
  {
    from: "THR",
    to: "BER",
    legs: daily({ airlineCode: "IR", number: 723, depart: "03:40", minutes: 355, aircraft: "Airbus A330-200", price: 17_400_000, checkedKg: 30, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "LHR",
    legs: daily({ airlineCode: "TK", number: 797, depart: "02:50", minutes: 480, aircraft: "Boeing 787-9", price: 24_600_000, checkedKg: 23, cabinKg: 8, refundable: true, stops: 1, via: "IST", layover: 85 }),
  },
  {
    from: "THR",
    to: "CDG",
    legs: daily({ airlineCode: "IR", number: 731, depart: "04:15", minutes: 390, aircraft: "Airbus A330-200", price: 18_200_000, checkedKg: 30, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "AMS",
    legs: daily({ airlineCode: "TK", number: 881, depart: "03:30", minutes: 505, aircraft: "Airbus A321neo", price: 19_100_000, checkedKg: 23, cabinKg: 8, refundable: true, stops: 1, via: "IST", layover: 95 }),
  },
  {
    from: "THR",
    to: "VIE",
    legs: daily({ airlineCode: "OS", number: 872, depart: "04:40", minutes: 350, aircraft: "Airbus A320", price: 17_900_000, checkedKg: 23, cabinKg: 8, refundable: true }),
  },
  {
    from: "THR",
    to: "ARN",
    legs: daily({ airlineCode: "TK", number: 814, depart: "03:55", minutes: 545, aircraft: "Airbus A321neo", price: 20_300_000, checkedKg: 23, cabinKg: 8, refundable: true, stops: 1, via: "IST", layover: 100 }),
  },

  // ——— Non-Tehran connectivity: the Gulf ⇄ Iran and Iran ⇄ Türkiye markets.
  // Without these, only Tehran could sell tickets; every other city was a dead end.
  {
    from: "DXB",
    to: "MHD",
    legs: daily({ airlineCode: "FZ", number: 251, depart: "10:15", minutes: 145, aircraft: "Boeing 737 MAX 8", price: 6_400_000, checkedKg: 20, cabinKg: 7, refundable: true }),
  },
  {
    from: "DXB",
    to: "SYZ",
    legs: daily({ airlineCode: "G9", number: 903, depart: "09:40", minutes: 135, aircraft: "Airbus A320", price: 5_900_000, checkedKg: 20, cabinKg: 7, refundable: false }),
  },
  {
    from: "DXB",
    to: "IST",
    legs: daily({ airlineCode: "EK", number: 121, depart: "13:30", minutes: 300, aircraft: "Boeing 777-300ER", price: 14_200_000, checkedKg: 30, cabinKg: 7, refundable: true }),
  },
  {
    from: "IST",
    to: "DXB",
    legs: daily({ airlineCode: "TK", number: 762, depart: "08:25", minutes: 275, aircraft: "Airbus A321neo", price: 12_800_000, checkedKg: 25, cabinKg: 8, refundable: true }),
  },
  {
    from: "IST",
    to: "MHD",
    legs: daily({ airlineCode: "TK", number: 894, depart: "06:50", minutes: 220, aircraft: "Airbus A321", price: 8_600_000, checkedKg: 25, cabinKg: 8, refundable: true }),
  },
  {
    from: "IST",
    to: "NJF",
    legs: daily({ airlineCode: "TK", number: 806, depart: "07:15", minutes: 190, aircraft: "Boeing 737-800", price: 7_900_000, checkedKg: 25, cabinKg: 8, refundable: false }),
  },
  {
    from: "IST",
    to: "THR",
    legs: daily({ airlineCode: "PC", number: 512, depart: "05:40", minutes: 195, aircraft: "Airbus A320neo", price: 4_850_000, checkedKg: 20, cabinKg: 8, refundable: false }),
  },
  {
    from: "MHD",
    to: "IST",
    legs: daily({ airlineCode: "TK", number: 895, depart: "14:10", minutes: 225, aircraft: "Airbus A321", price: 8_900_000, checkedKg: 25, cabinKg: 8, refundable: true }),
  },
  {
    from: "MHD",
    to: "DXB",
    legs: daily({ airlineCode: "FZ", number: 252, depart: "15:20", minutes: 150, aircraft: "Boeing 737 MAX 8", price: 6_600_000, checkedKg: 20, cabinKg: 7, refundable: true }),
  },
  {
    from: "SYZ",
    to: "DXB",
    legs: daily({ airlineCode: "G9", number: 904, depart: "14:05", minutes: 140, aircraft: "Airbus A320", price: 6_100_000, checkedKg: 20, cabinKg: 7, refundable: false }),
  },
  {
    from: "MHD",
    to: "DOH",
    legs: daily({ airlineCode: "QR", number: 495, depart: "04:30", minutes: 170, aircraft: "Airbus A320", price: 9_200_000, checkedKg: 30, cabinKg: 7, refundable: true }),
  },
  {
    from: "DXB",
    to: "DOH",
    legs: daily({ airlineCode: "QR", number: 1013, depart: "11:00", minutes: 65, aircraft: "Airbus A350-900", price: 4_300_000, checkedKg: 25, cabinKg: 7, refundable: true }),
  },
  {
    from: "THR",
    to: "DXB",
    legs: daily({ airlineCode: "FZ", number: 44, depart: "09:55", minutes: 130, aircraft: "Boeing 737-800", price: 5_100_000, checkedKg: 20, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "IST",
    legs: daily({ airlineCode: "TK", number: 879, depart: "12:30", minutes: 190, aircraft: "Airbus A321", price: 5_400_000, checkedKg: 25, cabinKg: 8, refundable: true }),
  },
  {
    from: "NJF",
    to: "IST",
    legs: daily({ airlineCode: "TK", number: 807, depart: "16:40", minutes: 185, aircraft: "Boeing 737-800", price: 8_100_000, checkedKg: 25, cabinKg: 8, refundable: false }),
  },
  {
    from: "THR",
    to: "FCO",
    legs: daily({ airlineCode: "IR", number: 741, depart: "05:20", minutes: 370, aircraft: "Airbus A330-200", price: 18_600_000, checkedKg: 30, cabinKg: 7, refundable: false }),
  },
];

function buildPatterns(): FlightPattern[] {
  const patterns: FlightPattern[] = [];
  for (const route of [...REGIONAL, ...domesticRoutes()]) {
    if (!route.legs.length) continue;
    for (const leg of route.legs) {
      const stops = (leg.stops ?? 0) as number;
      patterns.push({
        id: patternId(route.from, route.to, leg.airlineCode, leg.number),
        airlineCode: leg.airlineCode,
        flightNumber: `${leg.airlineCode}-${leg.number}`,
        originCode: route.from,
        destinationCode: route.to,
        departMinutes: toMinutes(leg.depart),
        durationMinutes: leg.minutes,
        days: leg.days ?? ALL,
        aircraft: leg.aircraft,
        stops,
        ...(leg.via ? { layoverAirport: leg.via } : {}),
        ...(leg.layover ? { layoverMinutes: leg.layover } : {}),
        basePriceToman: leg.price,
        checkedBaggageKg: leg.checkedKg,
        cabinBaggageKg: leg.cabinKg,
        refundable: leg.refundable,
        cabin: leg.cabin ?? "economy",
      });
    }
  }
  // Every served route flies both ways in real life. Rather than hand-writing
  // 60+ return legs, mirror any one-directional route with a deterministic
  // inverse rotation (later departure, same duration, a small fare difference).
  const keys = new Set(patterns.map((pattern) => `${pattern.originCode}-${pattern.destinationCode}`));
  const generated: FlightPattern[] = [];
  for (const pattern of patterns) {
    const reverseKey = `${pattern.destinationCode}-${pattern.originCode}`;
    if (keys.has(reverseKey)) continue;
    keys.add(reverseKey);
    // Keep the return leg inside civil daylight so it never wraps past midnight.
    let departMinutes = (pattern.departMinutes + 660) % 1440;
    if (departMinutes < 300) departMinutes += 360;
    if (departMinutes > 1290) departMinutes -= 360;
    generated.push({
      ...pattern,
      id: patternId(pattern.destinationCode, pattern.originCode, pattern.airlineCode, pattern.flightNumber),
      originCode: pattern.destinationCode,
      destinationCode: pattern.originCode,
      departMinutes,
      basePriceToman: Math.round((pattern.basePriceToman * 1.02) / 10_000) * 10_000,
    });
  }
  return [...patterns, ...generated];
}

export const FLIGHT_PATTERNS: FlightPattern[] = buildPatterns();

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
    (pattern) =>
      pattern.originCode === originCode.toUpperCase() &&
      pattern.destinationCode === destinationCode.toUpperCase() &&
      pattern.days.includes(weekday),
  );
}

/** Routes that have demo data, used by the homepage chips and validation. */
export function availableRoutes(): { originCode: string; destinationCode: string }[] {
  const seen = new Set<string>();
  const routes: { originCode: string; destinationCode: string }[] = [];
  for (const pattern of FLIGHT_PATTERNS) {
    const key = `${pattern.originCode}-${pattern.destinationCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ originCode: pattern.originCode, destinationCode: pattern.destinationCode });
  }
  return routes;
}

/** Routes departing from a given origin (for "where can I fly from here?"). */
export function destinationsFrom(originCode: string): string[] {
  return [...new Set(FLIGHT_PATTERNS.filter((p) => p.originCode === originCode).map((p) => p.destinationCode))];
}

/** How many distinct routes the demo data covers in total. */
export function routeCount(): number {
  return availableRoutes().length;
}

/** Cities reachable from an origin, with how many weekly flights serve each route. */
export function destinationsWithCounts(originCode: string): { code: string; patterns: number }[] {
  const counts = new Map<string, number>();
  for (const pattern of FLIGHT_PATTERNS) {
    if (pattern.originCode !== originCode) continue;
    counts.set(pattern.destinationCode, (counts.get(pattern.destinationCode) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, patterns]) => ({ code, patterns }))
    .sort((a, b) => b.patterns - a.patterns || a.code.localeCompare(b.code));
}

/** Every city that is either a served origin or a served destination. */
export function servedCities(): string[] {
  const codes = new Set<string>();
  for (const pattern of FLIGHT_PATTERNS) {
    codes.add(pattern.originCode);
    codes.add(pattern.destinationCode);
  }
  return [...codes].sort();
}

/** Deterministic "is there demand" signal used for the homepage route suggestions. */
export function routePopularity(originCode: string, destinationCode: string): number {
  const count = FLIGHT_PATTERNS.filter(
    (p) => p.originCode === originCode && p.destinationCode === destinationCode,
  ).length;
  return count + seededUnit(`${originCode}${destinationCode}`) * 0.4;
}

/** Alias used by provider adapters (keeps their imports terse). */
export const materialize = materializePattern;
