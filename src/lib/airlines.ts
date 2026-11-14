export interface Airline {
  code: string;
  fa: string;
  en: string;
  /** Typical on-time reputation used by nothing but the demo narrative. */
  shortHaul: boolean;
}

export const AIRLINES: Airline[] = [
  { code: "IR", fa: "هما (ایران‌ایر)", en: "Iran Air", shortHaul: false },
  { code: "W5", fa: "ماهان ایر", en: "Mahan Air", shortHaul: false },
  // Kish Air — IATA `Y9`, ICAO `KIS` (the carrier that actually flies IFN⇄KIH).
  { code: "Y9", fa: "کیش‌ایر", en: "Kish Air", shortHaul: true },
  { code: "B9", fa: "ایران ایرتور", en: "Iran Airtour", shortHaul: false },
  { code: "TK", fa: "ترکیش ایرلاینز", en: "Turkish Airlines", shortHaul: false },
  { code: "PC", fa: "پگاسوس", en: "Pegasus", shortHaul: true },
  { code: "XQ", fa: "سان‌اکسپرس", en: "SunExpress", shortHaul: true },
  { code: "FZ", fa: "فلای‌دبی", en: "flydubai", shortHaul: true },
  { code: "EK", fa: "امارات", en: "Emirates", shortHaul: false },
  { code: "QR", fa: "قطر ایرویز", en: "Qatar Airways", shortHaul: false },
  { code: "WY", fa: "عمان ایر", en: "Oman Air", shortHaul: false },
  { code: "ZV", fa: "زاگرس ایر", en: "Zagros Airlines", shortHaul: true },
  { code: "EP", fa: "آسمان", en: "Aseman", shortHaul: true },
  { code: "LH", fa: "لوفت‌هانزا", en: "Lufthansa", shortHaul: false },
  { code: "OS", fa: "اتریش ایرلاینز", en: "Austrian Airlines", shortHaul: false },
  { code: "G9", fa: "العربیه", en: "Air Arabia", shortHaul: true },
  { code: "J9", fa: "الجزیره", en: "Jazeera Airways", shortHaul: true },
  { code: "OV", fa: "سلام‌ایر", en: "SalamAir", shortHaul: true },
  { code: "HY", fa: "ازبکستان ایرویز", en: "Uzbekistan Airways", shortHaul: false },
  { code: "KC", fa: "ایر آستانه", en: "Air Astana", shortHaul: false },
  { code: "GF", fa: "گلف ایر", en: "Gulf Air", shortHaul: true },
  { code: "RJ", fa: "رویال اردنی", en: "Royal Jordanian", shortHaul: false },
  { code: "IA", fa: "عراقی ایرویز", en: "Iraqi Airways", shortHaul: true },
];

const BY_CODE = new Map(AIRLINES.map((a) => [a.code, a]));

export function getAirline(code: string): Airline | null {
  return BY_CODE.get(code) ?? null;
}

export function airlineLabel(code: string): string {
  const airline = getAirline(code);
  return airline ? airline.fa : code;
}

/**
 * Find an explicitly named airline.
 *
 * Persian brand names are matched as substrings, but short latin aliases (IATA
 * codes such as "pc" or "ia") must match on a word boundary — otherwise "airport"
 * would resolve to an airline and silently filter every result.
 */
export function airlineCount(): number {
  return AIRLINES.length;
}

export function findAirlineInText(text: string, options: { strict?: boolean } = {}): string | null {
  const haystack = text.toLowerCase();
  for (const airline of AIRLINES) {
    const aliases = [airline.fa, airline.en, airline.code.toLowerCase(), ...airline.fa.split(/[\s()]+/)]
      .map((alias) => alias.toLowerCase().trim())
      .filter((alias) => alias.length >= 2);

    for (const alias of aliases) {
      // In strict mode only the brand itself counts — "ماهان" yes, but not the
      // IATA code "w5" appearing inside a flight number.
      if (options.strict && alias === airline.code.toLowerCase()) continue;
      if (/^[a-z0-9\s]+$/.test(alias)) {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack)) return airline.code;
      } else if (haystack.includes(alias)) {
        return airline.code;
      }
    }
  }
  return null;
}
