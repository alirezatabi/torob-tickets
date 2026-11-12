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
];

const BY_CODE = new Map(AIRLINES.map((a) => [a.code, a]));

export function getAirline(code: string): Airline | null {
  return BY_CODE.get(code) ?? null;
}

export function airlineLabel(code: string): string {
  const airline = getAirline(code);
  return airline ? airline.fa : code;
}

export function findAirlineInText(text: string): string | null {
  const haystack = text.toLowerCase();
  for (const airline of AIRLINES) {
    for (const alias of [airline.fa, airline.en, airline.code.toLowerCase(), ...airline.fa.split(/[\s()]+/)]) {
      if (alias.length >= 2 && haystack.includes(alias.toLowerCase())) return airline.code;
    }
  }
  return null;
}
