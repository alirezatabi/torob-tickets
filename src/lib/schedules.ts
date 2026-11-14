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
/** Sunday–Thursday: the Iranian working week (Friday is the weekly holiday). */
const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4];
/**
 * Thursday + Friday — the Iranian weekend, which is also what `quoteFare` prices as a peak
 * (`weekday === 4 || weekday === 5`). Saturday used to be included here, which contradicted
 * both the fare curve and the comments (B20).
 */
const WEEKEND: Weekday[] = [4, 5];

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

/**
 * Domestic city pairs that do **not** go through Tehran.
 *
 * The demo used to be hub-and-spoke: every domestic flight started or ended at THR, so
 * «اصفهان ← کیش» — the reference scenario of the product — returned "no flights" while the
 * README promised every city works as both origin and destination. Long-haul Iranian
 * domestic traffic is real (IFN⇄KIH and MHD⇄KIH especially), so the timetable now contains
 * a small mesh as well.
 *
 * Duration and base fare come from the **great-circle distance** between the two airports
 * (`haversineKm`), not from hand-tuned numbers: a shorter hop is a shorter, cheaper flight,
 * automatically and consistently. Frequency is one rotation per direction per carrier
 * pattern, and the two carriers are spread across the day so the demo has a morning and an
 * evening option.
 */
interface MeshPair {
  from: string;
  to: string;
  /** Carriers serving the pair, in the order their rotations are scheduled. */
  carriers: { airlineCode: string; number: number; depart: string }[];
}

const DOMESTIC_MESH: MeshPair[] = [
  // ——— The reference scenario: Isfahan ⇄ Kish ———
  {
    from: "IFN",
    to: "KIH",
    carriers: [
      { airlineCode: "IR", number: 3301, depart: "13:00" },
      { airlineCode: "Y9", number: 7204, depart: "19:00" },
    ],
  },
  {
    from: "KIH",
    to: "IFN",
    carriers: [
      { airlineCode: "IR", number: 3302, depart: "15:10" },
      { airlineCode: "Y9", number: 7205, depart: "21:00" },
    ],
  },
  // ——— Mashhad ⇄ Kish ———
  {
    from: "MHD",
    to: "KIH",
    carriers: [
      { airlineCode: "Y9", number: 7230, depart: "09:40" },
      { airlineCode: "IR", number: 3341, depart: "17:30" },
    ],
  },
  {
    from: "KIH",
    to: "MHD",
    carriers: [
      { airlineCode: "Y9", number: 7231, depart: "12:20" },
      { airlineCode: "IR", number: 3342, depart: "20:05" },
    ],
  },
  // ——— Shiraz ⇄ Kish ———
  {
    from: "SYZ",
    to: "KIH",
    carriers: [
      { airlineCode: "Y9", number: 7240, depart: "08:15" },
      { airlineCode: "EP", number: 3711, depart: "16:00" },
    ],
  },
  {
    from: "KIH",
    to: "SYZ",
    carriers: [
      { airlineCode: "Y9", number: 7241, depart: "10:30" },
      { airlineCode: "EP", number: 3712, depart: "18:10" },
    ],
  },
  // ——— Isfahan ⇄ Mashhad ———
  {
    from: "IFN",
    to: "MHD",
    carriers: [
      { airlineCode: "IR", number: 3361, depart: "07:20" },
      { airlineCode: "B9", number: 2631, depart: "14:40" },
    ],
  },
  {
    from: "MHD",
    to: "IFN",
    carriers: [
      { airlineCode: "IR", number: 3362, depart: "09:50" },
      { airlineCode: "B9", number: 2632, depart: "17:00" },
    ],
  },
  // ——— Isfahan ⇄ Shiraz ———
  {
    from: "IFN",
    to: "SYZ",
    carriers: [
      { airlineCode: "EP", number: 3731, depart: "11:10" },
      { airlineCode: "IR", number: 3381, depart: "18:20" },
    ],
  },
  {
    from: "SYZ",
    to: "IFN",
    carriers: [
      { airlineCode: "EP", number: 3732, depart: "13:20" },
      { airlineCode: "IR", number: 3382, depart: "20:30" },
    ],
  },
  // ——— Shiraz ⇄ Mashhad ———
  {
    from: "SYZ",
    to: "MHD",
    carriers: [
      { airlineCode: "B9", number: 2641, depart: "06:50" },
      { airlineCode: "IR", number: 3391, depart: "15:30" },
    ],
  },
  {
    from: "MHD",
    to: "SYZ",
    carriers: [
      { airlineCode: "B9", number: 2642, depart: "09:20" },
      { airlineCode: "IR", number: 3392, depart: "18:00" },
    ],
  },
  // ——— Tabriz ⇄ Kish ———
  {
    from: "TBZ",
    to: "KIH",
    carriers: [
      { airlineCode: "Y9", number: 7250, depart: "10:20" },
      { airlineCode: "B9", number: 2651, depart: "19:40" },
    ],
  },
  {
    from: "KIH",
    to: "TBZ",
    carriers: [
      { airlineCode: "Y9", number: 7251, depart: "13:50" },
      { airlineCode: "B9", number: 2652, depart: "23:00" },
    ],
  },
  // ——— Ahvaz ⇄ Kish ———
  {
    from: "AWZ",
    to: "KIH",
    carriers: [
      { airlineCode: "Y9", number: 7260, depart: "12:10" },
      { airlineCode: "EP", number: 3751, depart: "20:15" },
    ],
  },
  {
    from: "KIH",
    to: "AWZ",
    carriers: [
      { airlineCode: "Y9", number: 7261, depart: "14:40" },
      { airlineCode: "EP", number: 3752, depart: "22:30" },
    ],
  },
  // ——— Bandar Abbas ⇄ Kish ———
  {
    from: "BND",
    to: "KIH",
    carriers: [
      { airlineCode: "Y9", number: 7270, depart: "08:40" },
      { airlineCode: "IR", number: 3401, depart: "17:15" },
    ],
  },
  {
    from: "KIH",
    to: "BND",
    carriers: [
      { airlineCode: "Y9", number: 7271, depart: "10:30" },
      { airlineCode: "IR", number: 3402, depart: "19:00" },
    ],
  },
  // ——— Isfahan ⇄ Ahvaz ———
  {
    from: "IFN",
    to: "AWZ",
    carriers: [
      { airlineCode: "EP", number: 3771, depart: "09:30" },
      { airlineCode: "IR", number: 3421, depart: "16:50" },
    ],
  },
  {
    from: "AWZ",
    to: "IFN",
    carriers: [
      { airlineCode: "EP", number: 3772, depart: "11:50" },
      { airlineCode: "IR", number: 3422, depart: "19:10" },
    ],
  },
];

/**
 * Great-circle distance between two catalogue airports, in km.
 * Used for the mesh's block time and base fare so neither is invented on the spot.
 */
export function haversineKm(fromCode: string, toCode: string): number {
  const from = getCity(fromCode);
  const to = getCity(toCode);
  if (!from || !to) return 0;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLon = toRad(to.lon - from.lon);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(a)));
}

/**
 * Block time from distance: ~560 km/h cruise plus 25 minutes of taxi/climb/descent,
 * rounded up to five minutes (airline schedules are quoted that way).
 */
export function blockMinutesFor(km: number): number {
  return Math.max(45, Math.ceil((25 + km / 9.33) / 5) * 5);
}

/** Base economy fare from distance: a fixed handling cost plus a per-km fare. */
export function baseFareFor(km: number): number {
  return Math.round((850_000 + km * 4_100) / 10_000) * 10_000;
}

const MESH_FLEET = ["Airbus A320", "Boeing 737-400", "ATR 72", "Fokker 100"];

/** Both directions of every mesh pair, with distance-derived time and price. */
function domesticMesh(): RouteSpec[] {
  const routes: RouteSpec[] = [];
  for (const pair of DOMESTIC_MESH) {
    const km = haversineKm(pair.from, pair.to);
    if (km <= 0) continue;
    const minutes = blockMinutesFor(km);
    const price = baseFareFor(km);
    routes.push({
      from: pair.from,
      to: pair.to,
      legs: pair.carriers.map((carrier, index) => ({
        airlineCode: carrier.airlineCode,
        number: carrier.number,
        depart: carrier.depart,
        minutes,
        aircraft: MESH_FLEET[index % MESH_FLEET.length] ?? "Airbus A320",
        // The second carrier of the day is a little cheaper, like a real off-peak fare.
        price: index === 0 ? price : Math.round((price * 0.94) / 10_000) * 10_000,
        checkedKg: 20,
        cabinKg: 7,
        refundable: index === 0,
      })),
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
    from: "KIK",
    to: "DXB",
    legs: daily({ airlineCode: "G9", number: 407, depart: "09:05", minutes: 145, aircraft: "Airbus A320", price: 4_650_000, checkedKg: 20, cabinKg: 7, refundable: false, days: [1, 3, 5] }),
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
    legs: daily({ airlineCode: "TK", number: 1779, depart: "12:30", minutes: 190, aircraft: "Airbus A321", price: 5_400_000, checkedKg: 25, cabinKg: 8, refundable: true }),
  },
  {
    from: "NJF",
    to: "IST",
    legs: daily({ airlineCode: "TK", number: 807, depart: "16:40", minutes: 185, aircraft: "Boeing 737-800", price: 8_100_000, checkedKg: 25, cabinKg: 8, refundable: false }),
  },

  // ——— The other direction of every route: people also fly home. ———
  {
    from: "MHD",
    to: "THR",
    legs: daily({ airlineCode: "IR", number: 1551, depart: "09:10", minutes: 95, aircraft: "Airbus A320", price: 1_870_000, checkedKg: 20, cabinKg: 7, refundable: true }),
  },
  {
    from: "MHD",
    to: "THR",
    legs: daily({ airlineCode: "EP", number: 652, depart: "18:20", minutes: 100, aircraft: "Boeing 737-400", price: 1_940_000, checkedKg: 20, cabinKg: 5, refundable: false }),
  },
  {
    from: "SYZ",
    to: "THR",
    legs: daily({ airlineCode: "EP", number: 382, depart: "08:05", minutes: 105, aircraft: "Airbus A320", price: 1_980_000, checkedKg: 20, cabinKg: 7, refundable: false }),
  },
  {
    from: "SYZ",
    to: "THR",
    legs: daily({ airlineCode: "IR", number: 383, depart: "17:45", minutes: 110, aircraft: "Airbus A319", price: 2_060_000, checkedKg: 20, cabinKg: 7, refundable: true }),
  },
  {
    from: "IFN",
    to: "THR",
    legs: daily({ airlineCode: "IR", number: 331, depart: "12:30", minutes: 75, aircraft: "Airbus A320", price: 1_450_000, checkedKg: 20, cabinKg: 7, refundable: true }),
  },
  {
    from: "TBZ",
    to: "THR",
    legs: daily({ airlineCode: "B9", number: 262, depart: "13:15", minutes: 85, aircraft: "McDonnell Douglas MD-82", price: 1_410_000, checkedKg: 20, cabinKg: 7, refundable: false }),
  },
  {
    from: "KIH",
    to: "THR",
    legs: daily({ airlineCode: "W5", number: 342, depart: "16:10", minutes: 130, aircraft: "Airbus A310", price: 2_390_000, checkedKg: 30, cabinKg: 7, refundable: false }),
  },
  {
    from: "AWZ",
    to: "THR",
    legs: daily({ airlineCode: "ZV", number: 612, depart: "11:40", minutes: 90, aircraft: "Boeing 737-500", price: 1_590_000, checkedKg: 20, cabinKg: 5, refundable: false }),
  },
  {
    from: "BND",
    to: "THR",
    legs: daily({ airlineCode: "EP", number: 724, depart: "20:05", minutes: 140, aircraft: "Airbus A320", price: 2_180_000, checkedKg: 20, cabinKg: 7, refundable: false }),
  },
  {
    from: "GSM",
    to: "THR",
    legs: daily({ airlineCode: "W5", number: 452, depart: "12:55", minutes: 145, aircraft: "Airbus A310", price: 2_290_000, checkedKg: 30, cabinKg: 7, refundable: false }),
  },
  {
    from: "RAS",
    to: "THR",
    legs: daily({ airlineCode: "B9", number: 513, depart: "15:35", minutes: 70, aircraft: "Fokker 100", price: 1_350_000, checkedKg: 20, cabinKg: 7, refundable: false }),
  },
  {
    from: "KER",
    to: "THR",
    legs: daily({ airlineCode: "IR", number: 272, depart: "10:20", minutes: 110, aircraft: "Airbus A320", price: 1_710_000, checkedKg: 20, cabinKg: 7, refundable: true }),
  },
  {
    from: "ZAH",
    to: "THR",
    legs: daily({ airlineCode: "EP", number: 442, depart: "19:30", minutes: 125, aircraft: "Airbus A320", price: 1_820_000, checkedKg: 20, cabinKg: 7, refundable: false }),
  },
  {
    from: "OMH",
    to: "THR",
    legs: daily({ airlineCode: "ZV", number: 302, depart: "14:45", minutes: 100, aircraft: "Boeing 737-500", price: 1_640_000, checkedKg: 20, cabinKg: 5, refundable: false }),
  },
  {
    from: "AZD",
    to: "THR",
    legs: daily({ airlineCode: "B9", number: 191, depart: "09:55", minutes: 80, aircraft: "Fokker 100", price: 1_480_000, checkedKg: 20, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "IST",
    legs: daily({ airlineCode: "TK", number: 1773, depart: "04:25", minutes: 195, aircraft: "Airbus A321neo", price: 5_150_000, checkedKg: 25, cabinKg: 8, refundable: true }),
  },
  {
    from: "THR",
    to: "IST",
    legs: daily({ airlineCode: "PC", number: 511, depart: "03:35", minutes: 200, aircraft: "Airbus A320neo", price: 4_150_000, checkedKg: 20, cabinKg: 8, refundable: false }),
  },
  {
    from: "THR",
    to: "DXB",
    legs: daily({ airlineCode: "FZ", number: 43, depart: "20:15", minutes: 130, aircraft: "Boeing 737-800", price: 5_250_000, checkedKg: 20, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "DOH",
    legs: daily({ airlineCode: "QR", number: 496, depart: "17:05", minutes: 165, aircraft: "Airbus A320", price: 9_450_000, checkedKg: 30, cabinKg: 7, refundable: true }),
  },
  {
    from: "THR",
    to: "DOH",
    legs: daily({ airlineCode: "WY", number: 712, depart: "16:20", minutes: 175, aircraft: "Boeing 737 MAX 8", price: 9_150_000, checkedKg: 30, cabinKg: 7, refundable: true }),
  },
  {
    from: "THR",
    to: "MCT",
    legs: daily({ airlineCode: "WY", number: 718, depart: "18:40", minutes: 150, aircraft: "Boeing 737-800", price: 8_400_000, checkedKg: 30, cabinKg: 7, refundable: true }),
  },
  {
    from: "THR",
    to: "KWI",
    legs: daily({ airlineCode: "J9", number: 611, depart: "12:35", minutes: 125, aircraft: "Airbus A320neo", price: 6_150_000, checkedKg: 20, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "SHJ",
    legs: daily({ airlineCode: "G9", number: 631, depart: "15:10", minutes: 120, aircraft: "Airbus A320", price: 4_950_000, checkedKg: 20, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "RUH",
    legs: daily({ airlineCode: "GF", number: 771, depart: "14:25", minutes: 175, aircraft: "Airbus A321neo", price: 8_950_000, checkedKg: 25, cabinKg: 7, refundable: true }),
  },
  {
    from: "THR",
    to: "JED",
    legs: daily({ airlineCode: "RJ", number: 811, depart: "13:50", minutes: 200, aircraft: "Airbus A320", price: 9_250_000, checkedKg: 25, cabinKg: 7, refundable: true }),
  },
  {
    from: "THR",
    to: "NJF",
    legs: daily({ airlineCode: "IA", number: 921, depart: "07:45", minutes: 115, aircraft: "Boeing 737-800", price: 3_450_000, checkedKg: 20, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "BGW",
    legs: daily({ airlineCode: "IA", number: 933, depart: "11:05", minutes: 145, aircraft: "Boeing 737-800", price: 4_150_000, checkedKg: 20, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "DAM",
    legs: daily({ airlineCode: "IA", number: 941, depart: "16:55", minutes: 175, aircraft: "Boeing 737-800", price: 5_450_000, checkedKg: 20, cabinKg: 7, refundable: false, days: [2, 5] }),
  },
  {
    from: "THR",
    to: "BEY",
    legs: daily({ airlineCode: "IR", number: 851, depart: "09:20", minutes: 195, aircraft: "Airbus A320", price: 7_450_000, checkedKg: 25, cabinKg: 7, refundable: true }),
  },
  {
    from: "THR",
    to: "EVN",
    legs: daily({ airlineCode: "IR", number: 861, depart: "10:45", minutes: 105, aircraft: "Airbus A319", price: 5_250_000, checkedKg: 25, cabinKg: 7, refundable: true }),
  },
  {
    from: "THR",
    to: "TBS",
    legs: daily({ airlineCode: "IR", number: 871, depart: "08:55", minutes: 125, aircraft: "Airbus A320", price: 5_950_000, checkedKg: 25, cabinKg: 7, refundable: true }),
  },
  {
    from: "THR",
    to: "GYD",
    legs: daily({ airlineCode: "IR", number: 881, depart: "12:10", minutes: 100, aircraft: "Airbus A319", price: 4_950_000, checkedKg: 25, cabinKg: 7, refundable: true }),
  },
  {
    from: "THR",
    to: "ASB",
    legs: daily({ airlineCode: "IR", number: 891, depart: "05:35", minutes: 130, aircraft: "Airbus A320", price: 6_250_000, checkedKg: 25, cabinKg: 7, refundable: true }),
  },
  {
    from: "THR",
    to: "TAS",
    legs: daily({ airlineCode: "HY", number: 761, depart: "03:15", minutes: 185, aircraft: "Airbus A320", price: 3_460_000, checkedKg: 30, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "TAS",
    legs: daily({ airlineCode: "KC", number: 911, depart: "02:40", minutes: 170, aircraft: "Airbus A321", price: 3_890_000, checkedKg: 30, cabinKg: 7, refundable: true }),
  },
  {
    from: "THR",
    to: "KHI",
    legs: daily({ airlineCode: "W5", number: 1105, depart: "05:50", minutes: 180, aircraft: "Airbus A310", price: 3_020_000, checkedKg: 30, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "DEL",
    legs: daily({ airlineCode: "W5", number: 701, depart: "02:15", minutes: 250, aircraft: "Airbus A310", price: 10_450_000, checkedKg: 30, cabinKg: 7, refundable: true }),
  },
  {
    from: "THR",
    to: "BOM",
    legs: daily({ airlineCode: "W5", number: 703, depart: "03:05", minutes: 285, aircraft: "Airbus A310", price: 11_150_000, checkedKg: 30, cabinKg: 7, refundable: true }),
  },
  {
    from: "THR",
    to: "KIK",
    legs: daily({ airlineCode: "J9", number: 307, depart: "08:15", minutes: 165, aircraft: "Airbus A320", price: 2_590_000, checkedKg: 20, cabinKg: 7, refundable: false, days: [1, 4] }),
  },
  {
    from: "THR",
    to: "SAW",
    legs: daily({ airlineCode: "PC", number: 513, depart: "06:20", minutes: 195, aircraft: "Airbus A320neo", price: 4_050_000, checkedKg: 20, cabinKg: 8, refundable: false }),
  },
  {
    from: "THR",
    to: "AYT",
    legs: daily({ airlineCode: "XQ", number: 921, depart: "05:05", minutes: 215, aircraft: "Boeing 737-800", price: 6_350_000, checkedKg: 20, cabinKg: 8, refundable: false, days: [0, 3, 6] }),
  },
  {
    from: "THR",
    to: "ADB",
    legs: daily({ airlineCode: "XQ", number: 933, depart: "04:50", minutes: 205, aircraft: "Boeing 737-800", price: 6_150_000, checkedKg: 20, cabinKg: 8, refundable: false, days: [1, 4] }),
  },
  {
    from: "THR",
    to: "FRA",
    legs: daily({ airlineCode: "LH", number: 1501, depart: "02:25", minutes: 340, aircraft: "Airbus A340-300", price: 21_500_000, checkedKg: 23, cabinKg: 8, refundable: true, days: [0, 6, 2] }),
  },
  {
    from: "THR",
    to: "MUC",
    legs: daily({ airlineCode: "LH", number: 1539, depart: "02:05", minutes: 320, aircraft: "Airbus A330-300", price: 19_800_000, checkedKg: 23, cabinKg: 8, refundable: true }),
  },
  {
    from: "THR",
    to: "BER",
    legs: daily({ airlineCode: "IR", number: 757, depart: "23:40", minutes: 330, aircraft: "Airbus A330-200", price: 17_900_000, checkedKg: 30, cabinKg: 7, refundable: false, days: [2, 5] }),
  },
  {
    from: "THR",
    to: "LHR",
    legs: daily({ airlineCode: "IR", number: 711, depart: "07:30", minutes: 400, aircraft: "Airbus A330-200", price: 24_800_000, checkedKg: 30, cabinKg: 7, refundable: true, days: [0, 3, 5] }),
  },
  {
    from: "THR",
    to: "CDG",
    legs: daily({ airlineCode: "IR", number: 721, depart: "06:50", minutes: 415, aircraft: "Airbus A330-200", price: 23_900_000, checkedKg: 30, cabinKg: 7, refundable: true, days: [1, 4] }),
  },
  {
    from: "THR",
    to: "AMS",
    legs: daily({ airlineCode: "IR", number: 1631, depart: "07:10", minutes: 400, aircraft: "Airbus A330-200", price: 22_600_000, checkedKg: 30, cabinKg: 7, refundable: true, days: [2, 5] }),
  },
  {
    from: "THR",
    to: "VIE",
    legs: daily({ airlineCode: "OS", number: 1772, depart: "04:35", minutes: 330, aircraft: "Airbus A320neo", price: 14_900_000, checkedKg: 23, cabinKg: 8, refundable: true }),
  },
  {
    from: "THR",
    to: "ARN",
    legs: daily({ airlineCode: "IR", number: 751, depart: "05:45", minutes: 355, aircraft: "Airbus A330-200", price: 18_400_000, checkedKg: 30, cabinKg: 7, refundable: false, days: [1, 4] }),
  },
  // ——— Beyond Tehran: the Gulf hubs, Türkiye and the Caucasus also sell tickets
  // from their own city, not only as connections into Iran.
  {
    from: "IST",
    to: "DXB",
    legs: [
      { airlineCode: "TK", number: 1662, depart: "08:25", minutes: 275, aircraft: "Airbus A321neo", price: 12_800_000, checkedKg: 25, cabinKg: 8, refundable: true },
    ],
  },

  {
    from: "IST",
    to: "SAW",
    legs: [
      { airlineCode: "PC", number: 101, depart: "07:05", minutes: 55, aircraft: "Airbus A320", price: 1_250_000, checkedKg: 20, cabinKg: 8, refundable: false },
    ],
  },

  {
    from: "SAW",
    to: "IST",
    legs: [
      { airlineCode: "PC", number: 102, depart: "21:10", minutes: 55, aircraft: "Airbus A320", price: 1_190_000, checkedKg: 20, cabinKg: 8, refundable: false },
    ],
  },

  {
    from: "AYT",
    to: "IST",
    legs: [
      { airlineCode: "XQ", number: 922, depart: "09:40", minutes: 85, aircraft: "Boeing 737-800", price: 1_850_000, checkedKg: 20, cabinKg: 8, refundable: false },
    ],
  },

  {
    from: "ADB",
    to: "IST",
    legs: [
      { airlineCode: "XQ", number: 934, depart: "08:20", minutes: 75, aircraft: "Boeing 737-800", price: 1_620_000, checkedKg: 20, cabinKg: 8, refundable: false },
    ],
  },

  {
    from: "SHJ",
    to: "DXB",
    legs: [
      { airlineCode: "G9", number: 632, depart: "10:20", minutes: 45, aircraft: "Airbus A320", price: 1_150_000, checkedKg: 20, cabinKg: 7, refundable: false },
    ],
  },
  {
    from: "DAM",
    to: "IST",
    legs: [
      { airlineCode: "TK", number: 845, depart: "07:55", minutes: 175, aircraft: "Airbus A321", price: 7_950_000, checkedKg: 25, cabinKg: 8, refundable: true, days: [1, 4] },
    ],
  },

  {
    from: "DXB",
    to: "DOH",
    legs: [
      { airlineCode: "QR", number: 1913, depart: "11:00", minutes: 65, aircraft: "Airbus A350-900", price: 4_300_000, checkedKg: 25, cabinKg: 7, refundable: true },
    ],
  },

  {
    from: "DXB",
    to: "IST",
    legs: [
      { airlineCode: "EK", number: 1021, depart: "13:30", minutes: 300, aircraft: "Boeing 777-300ER", price: 14_200_000, checkedKg: 30, cabinKg: 7, refundable: true },
    ],
  },

  {
    from: "DOH",
    to: "DXB",
    legs: [
      { airlineCode: "QR", number: 1014, depart: "15:35", minutes: 70, aircraft: "Airbus A350-900", price: 4_450_000, checkedKg: 25, cabinKg: 7, refundable: true },
    ],
  },

  {
    from: "DOH",
    to: "MCT",
    legs: [
      { airlineCode: "WY", number: 662, depart: "12:45", minutes: 90, aircraft: "Boeing 737 MAX 8", price: 3_950_000, checkedKg: 25, cabinKg: 7, refundable: true },
    ],
  },

  {
    from: "DOH",
    to: "KWI",
    legs: [
      { airlineCode: "J9", number: 612, depart: "18:05", minutes: 95, aircraft: "Airbus A320neo", price: 4_150_000, checkedKg: 20, cabinKg: 7, refundable: false },
    ],
  },

  {
    from: "MCT",
    to: "DXB",
    legs: [
      { airlineCode: "WY", number: 719, depart: "09:15", minutes: 60, aircraft: "Boeing 737-800", price: 2_850_000, checkedKg: 25, cabinKg: 7, refundable: true },
    ],
  },

  {
    from: "KWI",
    to: "DOH",
    legs: [
      { airlineCode: "J9", number: 613, depart: "07:30", minutes: 90, aircraft: "Airbus A320neo", price: 4_050_000, checkedKg: 20, cabinKg: 7, refundable: false },
    ],
  },

  {
    from: "RUH",
    to: "DXB",
    legs: [
      { airlineCode: "FZ", number: 842, depart: "09:50", minutes: 110, aircraft: "Boeing 737 MAX 8", price: 5_850_000, checkedKg: 20, cabinKg: 7, refundable: false },
    ],
  },

  {
    from: "RUH",
    to: "JED",
    legs: [
      { airlineCode: "SV", number: 1015, depart: "07:40", minutes: 95, aircraft: "Airbus A320", price: 2_150_000, checkedKg: 25, cabinKg: 7, refundable: true },
    ],
  },

  {
    from: "JED",
    to: "RUH",
    legs: [
      { airlineCode: "SV", number: 1016, depart: "18:30", minutes: 95, aircraft: "Airbus A320", price: 2_050_000, checkedKg: 25, cabinKg: 7, refundable: true },
    ],
  },

  {
    from: "JED",
    to: "DXB",
    legs: [
      { airlineCode: "EK", number: 803, depart: "03:20", minutes: 175, aircraft: "Boeing 777-300ER", price: 9_150_000, checkedKg: 30, cabinKg: 7, refundable: true },
    ],
  },

  {
    from: "BGW",
    to: "DXB",
    legs: [
      { airlineCode: "IA", number: 934, depart: "08:40", minutes: 130, aircraft: "Boeing 737-800", price: 4_950_000, checkedKg: 20, cabinKg: 7, refundable: false },
    ],
  },

  {
    from: "BGW",
    to: "IST",
    legs: [
      { airlineCode: "TK", number: 1697, depart: "06:15", minutes: 190, aircraft: "Airbus A321", price: 7_450_000, checkedKg: 25, cabinKg: 8, refundable: true },
    ],
  },

  {
    from: "BGW",
    to: "DAM",
    legs: [
      { airlineCode: "IA", number: 942, depart: "12:20", minutes: 70, aircraft: "Boeing 737-800", price: 2_250_000, checkedKg: 20, cabinKg: 7, refundable: false },
    ],
  },

  {
    from: "BEY",
    to: "IST",
    legs: [
      { airlineCode: "TK", number: 827, depart: "09:35", minutes: 145, aircraft: "Airbus A321", price: 6_850_000, checkedKg: 25, cabinKg: 8, refundable: true },
    ],
  },

  {
    from: "BEY",
    to: "DXB",
    legs: [
      { airlineCode: "EK", number: 954, depart: "15:45", minutes: 205, aircraft: "Boeing 777-300ER", price: 10_450_000, checkedKg: 30, cabinKg: 7, refundable: true },
    ],
  },

  {
    from: "EVN",
    to: "IST",
    legs: [
      { airlineCode: "TK", number: 379, depart: "04:50", minutes: 160, aircraft: "Airbus A321", price: 6_450_000, checkedKg: 25, cabinKg: 8, refundable: true },
    ],
  },

  {
    from: "EVN",
    to: "DXB",
    legs: [
      { airlineCode: "FZ", number: 174, depart: "11:25", minutes: 215, aircraft: "Boeing 737 MAX 8", price: 8_450_000, checkedKg: 20, cabinKg: 7, refundable: false },
    ],
  },

  {
    from: "TBS",
    to: "IST",
    legs: [
      { airlineCode: "TK", number: 381, depart: "05:40", minutes: 170, aircraft: "Airbus A321", price: 7_150_000, checkedKg: 25, cabinKg: 8, refundable: true },
    ],
  },

  {
    from: "TBS",
    to: "DXB",
    legs: [
      { airlineCode: "FZ", number: 184, depart: "13:10", minutes: 215, aircraft: "Boeing 737 MAX 8", price: 8_950_000, checkedKg: 20, cabinKg: 7, refundable: false },
    ],
  },

  {
    from: "GYD",
    to: "IST",
    legs: [
      { airlineCode: "TK", number: 335, depart: "07:20", minutes: 180, aircraft: "Airbus A321", price: 7_950_000, checkedKg: 25, cabinKg: 8, refundable: true },
    ],
  },

  {
    from: "GYD",
    to: "DXB",
    legs: [
      { airlineCode: "FZ", number: 194, depart: "14:45", minutes: 200, aircraft: "Boeing 737 MAX 8", price: 7_850_000, checkedKg: 20, cabinKg: 7, refundable: false },
    ],
  },

  {
    from: "ASB",
    to: "IST",
    legs: [
      { airlineCode: "TK", number: 323, depart: "06:30", minutes: 185, aircraft: "Airbus A321", price: 8_450_000, checkedKg: 25, cabinKg: 8, refundable: true },
    ],
  },

  {
    from: "ASB",
    to: "DXB",
    legs: [
      { airlineCode: "FZ", number: 702, depart: "15:55", minutes: 180, aircraft: "Boeing 737 MAX 8", price: 7_450_000, checkedKg: 20, cabinKg: 7, refundable: false },
    ],
  },

  {
    from: "TAS",
    to: "IST",
    legs: [
      { airlineCode: "TK", number: 371, depart: "08:10", minutes: 300, aircraft: "Airbus A330-300", price: 12_450_000, checkedKg: 30, cabinKg: 8, refundable: true },
    ],
  },

  {
    from: "TAS",
    to: "DXB",
    legs: [
      { airlineCode: "FZ", number: 712, depart: "16:20", minutes: 230, aircraft: "Boeing 737 MAX 8", price: 8_650_000, checkedKg: 20, cabinKg: 7, refundable: false },
    ],
  },

  {
    from: "KHI",
    to: "DXB",
    legs: [
      { airlineCode: "EK", number: 601, depart: "05:15", minutes: 150, aircraft: "Boeing 777-300ER", price: 8_150_000, checkedKg: 30, cabinKg: 7, refundable: true },
    ],
  },

  {
    from: "DEL",
    to: "DXB",
    legs: [
      { airlineCode: "EK", number: 513, depart: "04:30", minutes: 210, aircraft: "Boeing 777-300ER", price: 10_950_000, checkedKg: 30, cabinKg: 7, refundable: true },
    ],
  },

  {
    from: "BOM",
    to: "DXB",
    legs: [
      { airlineCode: "EK", number: 503, depart: "02:45", minutes: 195, aircraft: "Boeing 777-300ER", price: 10_150_000, checkedKg: 30, cabinKg: 7, refundable: true },
    ],
  },

  {
    from: "FRA",
    to: "IST",
    legs: [
      { airlineCode: "TK", number: 1590, depart: "11:40", minutes: 185, aircraft: "Airbus A321neo", price: 11_850_000, checkedKg: 25, cabinKg: 8, refundable: true },
    ],
  },

  {
    from: "FRA",
    to: "LHR",
    legs: [
      { airlineCode: "LH", number: 916, depart: "08:15", minutes: 95, aircraft: "Airbus A320neo", price: 6_150_000, checkedKg: 23, cabinKg: 8, refundable: true },
    ],
  },

  {
    from: "MUC",
    to: "FRA",
    legs: [
      { airlineCode: "LH", number: 103, depart: "07:45", minutes: 65, aircraft: "Airbus A320", price: 4_250_000, checkedKg: 23, cabinKg: 8, refundable: true },
    ],
  },

  {
    from: "LHR",
    to: "CDG",
    legs: [
      { airlineCode: "AF", number: 1681, depart: "09:05", minutes: 80, aircraft: "Airbus A320", price: 5_650_000, checkedKg: 23, cabinKg: 8, refundable: true },
    ],
  },

  {
    from: "CDG",
    to: "AMS",
    legs: [
      { airlineCode: "AF", number: 1240, depart: "10:30", minutes: 75, aircraft: "Airbus A319", price: 4_950_000, checkedKg: 23, cabinKg: 8, refundable: true },
    ],
  },

  {
    from: "AMS",
    to: "FRA",
    legs: [
      { airlineCode: "LH", number: 989, depart: "12:20", minutes: 70, aircraft: "Airbus A320", price: 4_450_000, checkedKg: 23, cabinKg: 8, refundable: true },
    ],
  },

  {
    from: "VIE",
    to: "FRA",
    legs: [
      { airlineCode: "OS", number: 127, depart: "08:50", minutes: 85, aircraft: "Airbus A320", price: 5_050_000, checkedKg: 23, cabinKg: 8, refundable: true },
    ],
  },

  {
    from: "BER",
    to: "MUC",
    legs: [
      { airlineCode: "LH", number: 1965, depart: "13:15", minutes: 65, aircraft: "Airbus A320", price: 4_150_000, checkedKg: 23, cabinKg: 8, refundable: true },
    ],
  },

  {
    from: "ARN",
    to: "FRA",
    legs: [
      { airlineCode: "LH", number: 803, depart: "07:05", minutes: 125, aircraft: "Airbus A320neo", price: 7_150_000, checkedKg: 23, cabinKg: 8, refundable: true },
    ],
  },

  {
    from: "FCO",
    to: "VIE",
    legs: [
      { airlineCode: "OS", number: 506, depart: "10:40", minutes: 95, aircraft: "Airbus A320", price: 5_450_000, checkedKg: 23, cabinKg: 8, refundable: true },
    ],
  },

  {
    from: "THR",
    to: "FCO",
    legs: daily({ airlineCode: "IR", number: 741, depart: "05:20", minutes: 370, aircraft: "Airbus A330-200", price: 18_600_000, checkedKg: 30, cabinKg: 7, refundable: false }),
  },
  {
    from: "THR",
    to: "FCO",
    legs: daily({ airlineCode: "IR", number: 1641, depart: "05:20", minutes: 370, aircraft: "Airbus A330-200", price: 18_600_000, checkedKg: 30, cabinKg: 7, refundable: false }),
  },
];

function buildPatterns(): FlightPattern[] {
  const patterns: FlightPattern[] = [];
  for (const route of [...REGIONAL, ...domesticRoutes(), ...domesticMesh()]) {
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
  return patterns;
}

/**
 * Expand the hand-curated core timetable into a dense, deterministic demo schedule.
 *
 * Every city pair gets at least eight schedule patterns spread across the clock (subject
 * to each pattern's operating weekdays); the busiest routes can have up to sixteen. Clones keep a coherent airline/aircraft and
 * operating-week pattern, but receive their own flight number and fare, so aggregation,
 * sorting, filters and ticket details all exercise a substantial set of distinct trips.
 */
function expandDemoRotations(basePatterns: FlightPattern[]): FlightPattern[] {
  const byRoute = new Map<string, FlightPattern[]>();
  for (const pattern of basePatterns) {
    const key = `${pattern.originCode}-${pattern.destinationCode}`;
    const route = byRoute.get(key) ?? [];
    route.push(pattern);
    byRoute.set(key, route);
  }

  const expanded: FlightPattern[] = [];
  for (const [routeKey, routePatterns] of byRoute) {
    const ordered = [...routePatterns].sort(
      (a, b) => a.departMinutes - b.departMinutes || a.flightNumber.localeCompare(b.flightNumber),
    );
    expanded.push(...ordered);
    const target = Math.min(16, Math.max(8, ordered.length * 2));
    const occupied = ordered.map((pattern) => pattern.departMinutes);
    const usedIds = new Set(ordered.map((pattern) => pattern.id));
    const copies = new Map<string, number>();

    while (occupied.length < target) {
      // Pick the half-hour slot farthest from existing departures. This fills the day
      // evenly rather than piling every synthetic ticket into a single time window.
      let departure = 0;
      let bestDistance = -1;
      let bestTie = Number.POSITIVE_INFINITY;
      for (let candidate = 0; candidate < 24 * 60; candidate += 30) {
        const nearest = Math.min(
          ...occupied.map((minute) => {
            const distance = Math.abs(candidate - minute);
            return Math.min(distance, 24 * 60 - distance);
          }),
        );
        const tie = seededUnit(`${routeKey}:departure:${candidate}`);
        if (nearest > bestDistance || (nearest === bestDistance && tie < bestTie)) {
          departure = candidate;
          bestDistance = nearest;
          bestTie = tie;
        }
      }
      occupied.push(departure);

      const source = ordered[(occupied.length - ordered.length - 1) % ordered.length]!;
      const copyNumber = (copies.get(source.id) ?? 0) + 1;
      copies.set(source.id, copyNumber);
      let flightNumberValue = Number(source.flightNumber.slice(source.flightNumber.lastIndexOf("-") + 1)) + copyNumber * 1000;
      let id = `${patternId(source.originCode, source.destinationCode, source.airlineCode, flightNumberValue)}-rotation-${copyNumber}`;
      while (usedIds.has(id)) {
        flightNumberValue += 1;
        id = `${patternId(source.originCode, source.destinationCode, source.airlineCode, flightNumberValue)}-rotation-${copyNumber}`;
      }
      usedIds.add(id);

      const variation = seededUnit(`${routeKey}:${source.id}:fare:${copyNumber}`);
      const basePriceToman = Math.round((source.basePriceToman * (1.05 + variation * 0.25)) / 10_000) * 10_000;
      expanded.push({
        ...source,
        id,
        flightNumber: `${source.airlineCode}-${flightNumberValue}`,
        departMinutes: departure,
        basePriceToman,
      });
    }
  }
  return expanded;
}

export const FLIGHT_PATTERNS: FlightPattern[] = expandDemoRotations(buildPatterns());

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
