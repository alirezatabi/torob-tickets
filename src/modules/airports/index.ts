/**
 * Airport ↔ city resolution.
 *
 * Real sources speak in **airport** IATA codes (THR = Mehrabad, IKA = Imam Khomeini,
 * MHD = Mashhad), while the product's catalog is **city**-level (THR = Tehran).
 * The demo dataset collapsed the two, which is fine for fixtures and wrong for live
 * data: a THR→IST query must also include IKA departures, and an IKA→IST offer must
 * not be grouped with a THR→IST one.
 *
 * This module owns that translation in one place:
 *   airport → city      (always defined for airports we serve)
 *   city → airports     (all airports a city query must cover, intl first)
 *   source code → ours  (per-source aliases, e.g. "IKA" → city THR, airport IKA)
 */

export type AirportKind = "domestic" | "international" | "both";

export interface AirportInfo {
  /** IATA airport code, uppercase. */
  code: string;
  /** City code used across the product catalog (THR, MHD, IST, …). */
  cityCode: string;
  fa: string;
  en: string;
  kind: AirportKind;
}

/**
 * Airports that are actually served by Iranian providers and by the sources we
 * integrate. Kept small and explicit: every entry is a code we have seen in a real
 * response or in the source's own airport list.
 */
const AIRPORTS: AirportInfo[] = [
  // ——— Iran: multi-airport cities ———
  { code: "THR", cityCode: "THR", fa: "مهرآباد", en: "Mehrabad", kind: "domestic" },
  { code: "IKA", cityCode: "THR", fa: "امام خمینی", en: "Imam Khomeini", kind: "international" },
  { code: "PYK", cityCode: "THR", fa: "پیام", en: "Payam", kind: "domestic" },
  // ——— Iran: single-airport cities ———
  { code: "MHD", cityCode: "MHD", fa: "هاشمی‌نژاد", en: "Mashhad", kind: "both" },
  { code: "SYZ", cityCode: "SYZ", fa: "شیراز", en: "Shiraz", kind: "both" },
  { code: "IFN", cityCode: "IFN", fa: "شهید بهشتی", en: "Isfahan", kind: "both" },
  { code: "TBZ", cityCode: "TBZ", fa: "شهید مدنی", en: "Tabriz", kind: "both" },
  { code: "KIH", cityCode: "KIH", fa: "کیش", en: "Kish", kind: "both" },
  { code: "AWZ", cityCode: "AWZ", fa: "اهواز", en: "Ahvaz", kind: "both" },
  { code: "BND", cityCode: "BND", fa: "بندرعباس", en: "Bandar Abbas", kind: "both" },
  { code: "GSM", cityCode: "GSM", fa: "قشم", en: "Qeshm", kind: "both" },
  { code: "RAS", cityCode: "RAS", fa: "رشت", en: "Rasht", kind: "both" },
  { code: "KER", cityCode: "KER", fa: "کرمان", en: "Kerman", kind: "both" },
  { code: "ZAH", cityCode: "ZAH", fa: "زاهدان", en: "Zahedan", kind: "both" },
  { code: "OMH", cityCode: "OMH", fa: "ارومیه", en: "Urmia", kind: "both" },
  { code: "AZD", cityCode: "AZD", fa: "یزد", en: "Yazd", kind: "both" },
  { code: "NJF", cityCode: "NJF", fa: "نجف", en: "Najaf", kind: "international" },
  // ——— Region ———
  { code: "IST", cityCode: "IST", fa: "استانبول", en: "Istanbul", kind: "international" },
  { code: "SAW", cityCode: "SAW", fa: "صبیحا", en: "Sabiha Gokcen", kind: "international" },
  { code: "AYT", cityCode: "AYT", fa: "آنتالیا", en: "Antalya", kind: "international" },
  { code: "ADB", cityCode: "ADB", fa: "ازمیر", en: "Izmir", kind: "international" },
  { code: "DXB", cityCode: "DXB", fa: "دبی", en: "Dubai", kind: "international" },
  { code: "SHJ", cityCode: "SHJ", fa: "شارجه", en: "Sharjah", kind: "international" },
  { code: "DOH", cityCode: "DOH", fa: "دوحه", en: "Doha", kind: "international" },
  { code: "MCT", cityCode: "MCT", fa: "مسقط", en: "Muscat", kind: "international" },
  { code: "KWI", cityCode: "KWI", fa: "کویت", en: "Kuwait", kind: "international" },
  { code: "RUH", cityCode: "RUH", fa: "ریاض", en: "Riyadh", kind: "international" },
  { code: "JED", cityCode: "JED", fa: "جده", en: "Jeddah", kind: "international" },
  { code: "BGW", cityCode: "BGW", fa: "بغداد", en: "Baghdad", kind: "international" },
  { code: "KIK", cityCode: "KIK", fa: "کرکوک", en: "Kirkuk", kind: "international" },
  { code: "DAM", cityCode: "DAM", fa: "دمشق", en: "Damascus", kind: "international" },
  { code: "BEY", cityCode: "BEY", fa: "بیروت", en: "Beirut", kind: "international" },
  { code: "EVN", cityCode: "EVN", fa: "ایروان", en: "Yerevan", kind: "international" },
  { code: "TBS", cityCode: "TBS", fa: "تفلیس", en: "Tbilisi", kind: "international" },
  { code: "GYD", cityCode: "GYD", fa: "باکو", en: "Baku", kind: "international" },
  { code: "ASB", cityCode: "ASB", fa: "عشق‌آباد", en: "Ashgabat", kind: "international" },
  { code: "TAS", cityCode: "TAS", fa: "تاشکند", en: "Tashkent", kind: "international" },
  { code: "DEL", cityCode: "DEL", fa: "دهلی", en: "Delhi", kind: "international" },
  { code: "BOM", cityCode: "BOM", fa: "مومبای", en: "Mumbai", kind: "international" },
  { code: "KHI", cityCode: "KHI", fa: "کراچی", en: "Karachi", kind: "international" },
  // ——— Europe ———
  { code: "FRA", cityCode: "FRA", fa: "فرانکفورت", en: "Frankfurt", kind: "international" },
  { code: "BER", cityCode: "BER", fa: "برلین", en: "Berlin", kind: "international" },
  { code: "MUC", cityCode: "MUC", fa: "مونیخ", en: "Munich", kind: "international" },
  { code: "LHR", cityCode: "LHR", fa: "هیترو", en: "Heathrow", kind: "international" },
  { code: "CDG", cityCode: "CDG", fa: "شارل دوگل", en: "Charles de Gaulle", kind: "international" },
  { code: "AMS", cityCode: "AMS", fa: "اسخیپول", en: "Schiphol", kind: "international" },
  { code: "VIE", cityCode: "VIE", fa: "وین", en: "Vienna", kind: "international" },
  { code: "ARN", cityCode: "ARN", fa: "استکهلم", en: "Stockholm", kind: "international" },
  { code: "FCO", cityCode: "FCO", fa: "فیومیچینو", en: "Rome Fiumicino", kind: "international" },
];

const AIRPORT_BY_CODE = new Map(AIRPORTS.map((airport) => [airport.code, airport]));

export function getAirport(code: string | null | undefined): AirportInfo | null {
  if (!code) return null;
  return AIRPORT_BY_CODE.get(code.toUpperCase()) ?? null;
}

export function airportCity(code: string | null | undefined): string | null {
  return getAirport(code)?.cityCode ?? null;
}

/**
 * All airports a search for `cityCode` must cover, ordered by usefulness:
 * an international city gets its international airport first, a domestic route is
 * usually served from the domestic one. Unknown codes fall back to themselves so a
 * source that only understands airports still receives something sensible.
 */
export function airportsForCity(cityCode: string, opts: { international?: boolean } = {}): string[] {
  const code = cityCode.toUpperCase();
  const matches = AIRPORTS.filter((airport) => airport.cityCode === code);
  if (matches.length === 0) return [code];

  const ranked = [...matches].sort((a, b) => {
    const score = (airport: AirportInfo) => {
      if (opts.international) return airport.kind === "international" ? 0 : airport.kind === "both" ? 1 : 2;
      return airport.kind === "domestic" ? 0 : airport.kind === "both" ? 1 : 2;
    };
    return score(a) - score(b);
  });
  return ranked.map((airport) => airport.code);
}

/** The airport a source most likely means when it publishes only a city code. */
export function primaryAirportFor(cityCode: string, international = false): string {
  return airportsForCity(cityCode, { international })[0] ?? cityCode.toUpperCase();
}

/** Does this airport belong to the requested city? Used when validating responses. */
export function airportServesCity(airportCode: string, cityCode: string): boolean {
  return airportCity(airportCode) === cityCode.toUpperCase();
}

export function listAirports(): AirportInfo[] {
  return [...AIRPORTS];
}
