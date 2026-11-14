/**
 * Live airline registry.
 *
 * The demo catalogue (`src/lib/airlines.ts`) only contains carriers the demo
 * schedules; live sources return carriers we have never named (Saha, Karun, FlyPersia,
 * ATA, …). This registry is the additive layer for them:
 *   • the demo catalogue stays untouched (its ranking copy depends on it);
 *   • codes seen on real pages are registered here with Persian names;
 *   • unknown codes still resolve to their code, never to a wrong airline.
 *
 * The only thing that must never happen is *guessing* a code → airline mapping, so
 * two independent signals are used: an explicit per-source alias table and a
 * normalised Persian-name → code table.
 */

export interface LiveAirline {
  code: string;
  fa: string;
  en: string;
}

/**
 * Codes observed in Sepehr360's airline logos/markdown (verified against the real
 * search pages) plus the carriers known to fly Iranian routes.
 */
export const LIVE_AIRLINES: LiveAirline[] = [
  { code: "IR", fa: "هما (ایران‌ایر)", en: "Iran Air" },
  { code: "W5", fa: "ماهان ایر", en: "Mahan Air" },
  { code: "B9", fa: "ایران ایرتور", en: "Iran Airtour" },
  { code: "I3", fa: "آتا ایر", en: "ATA Airlines" },
  { code: "NV", fa: "کارون", en: "Karun Airlines" },
  { code: "IS", fa: "سپهران", en: "Sepahan Airlines" },
  { code: "QB", fa: "قشم ایر", en: "Qeshm Air" },
  { code: "ATS", fa: "اطلس ایر", en: "Atlas Air" },
  { code: "MEH", fa: "مهر", en: "Mehr Airlines" },
  { code: "J1", fa: "معراج", en: "Meraj Airlines" },
  { code: "TKN", fa: "فلای کیش", en: "Fly Kish" },
  { code: "DZD", fa: "یزد ایر", en: "Yazd Air" },
  { code: "NSN", fa: "نسیم ایر", en: "Nasim Air" },
  { code: "VR", fa: "وارش", en: "Varesh Airlines" },
  { code: "AXV", fa: "آوا", en: "Ava Airlines" },
  { code: "CPN", fa: "کاسپین", en: "Caspian Airlines" },
  // A7 is printed next to "آسا جت" on the live search page.
  { code: "A7", fa: "آسا جت", en: "Asa Jet" },
  { code: "IRX", fa: "ایران ایرتور (نماد جایگزین)", en: "Iran Airtour (alt)" },
  { code: "W5X", fa: "ماهان (نماد جایگزین)", en: "Mahan (alt)" },
  // Foreign carriers that actually serve Iranian routes
  { code: "TK", fa: "ترکیش ایرلاینز", en: "Turkish Airlines" },
  { code: "PC", fa: "پگاسوس", en: "Pegasus" },
  { code: "XQ", fa: "سان‌اکسپرس", en: "SunExpress" },
  { code: "FZ", fa: "فلای‌دبی", en: "flydubai" },
  { code: "EK", fa: "امارات", en: "Emirates" },
  { code: "QR", fa: "قطر ایرویز", en: "Qatar Airways" },
  { code: "WY", fa: "عمان ایر", en: "Oman Air" },
  { code: "LH", fa: "لوفت‌هانزا", en: "Lufthansa" },
  { code: "OS", fa: "اتریش ایرلاینز", en: "Austrian Airlines" },
  { code: "G9", fa: "العربیه", en: "Air Arabia" },
  { code: "J9", fa: "الجزیره", en: "Jazeera Airways" },
  { code: "OV", fa: "سلام‌ایر", en: "SalamAir" },
  { code: "GF", fa: "گلف ایر", en: "Gulf Air" },
  { code: "RJ", fa: "رویال اردنی", en: "Royal Jordanian" },
  { code: "IA", fa: "عراقی ایرویز", en: "Iraqi Airways" },
  { code: "HY", fa: "ازبکستان ایرویز", en: "Uzbekistan Airways" },
  { code: "KC", fa: "ایر آستانه", en: "Air Astana" },
  { code: "EP", fa: "آسمان", en: "Aseman" },
  { code: "ZV", fa: "زاگرس ایر", en: "Zagros Airlines" },
  { code: "HH", fa: "هواپیمایی هما (نماد قدیم)", en: "Homa (legacy)" },
  { code: "THY", fa: "ترکیش ایرلاینز (نماد جایگزین)", en: "Turkish Airlines (alt)" },
  { code: "SMR", fa: "سما", en: "Sama Airlines" },
  { code: "KIS", fa: "کیش ایر", en: "Kish Air" },
  { code: "Y9", fa: "کیش ایر", en: "Kish Air" },
  { code: "IZG", fa: "زاگرس (نماد جایگزین)", en: "Zagros (alt)" },
  { code: "UZ", fa: "یزد ایر", en: "Yazd Air" },
  { code: "ABY", fa: "ایران ایر (نماد جایگزین)", en: "Iran Air (alt)" },
  { code: "TBZ", fa: "تابان ایر", en: "Taban Air" },
  { code: "TBN", fa: "تابان ایر", en: "Taban Air" },
  { code: "SHI", fa: "شیراز ایر", en: "Shiraz Air" },
  { code: "SAH", fa: "ساها (نماد جایگزین)", en: "Saha (alt)" },
  { code: "PRS", fa: "پارس ایر", en: "Pars Air" },
  { code: "VRS", fa: "وارش (نماد جایگزین)", en: "Varesh (alt)" },
  { code: "KRN", fa: "کارون (نماد جایگزین)", en: "Karun (alt)" },
  { code: "QSM", fa: "قشم ایر (نماد جایگزین)", en: "Qeshm (alt)" },
  { code: "FP", fa: "فلای‌پرشیا", en: "FlyPersia" },
  { code: "SEP", fa: "سپهران", en: "Sepahan Airlines" },
  { code: "CPT", fa: "کاسپین (نماد جایگزین)", en: "Caspian (alt)" },
];

/**
 * Persian name → code, normalised (ZWNJ/ی/ک spelling variants collapsed).
 * Needed because Sepehr360 prints airline names in text as well as in logo URLs.
 */
const FA_TO_CODE: Record<string, string> = {
  "ایران ایر": "IR",
  هما: "IR",
  ماهان: "W5",
  "ماهان ایر": "W5",
  "ایران ایرتور": "B9",
  "ایران تور": "B9",
  آتا: "I3",
  "آتا ایر": "I3",
  ساها: "NV",
  کارون: "NV",
  سپهران: "IS",
  قشم: "QB",
  "قشم ایر": "QB",
  آسمان: "EP",
  پارس: "PRS",
  "پارس ایر": "PRS",
  // Sepehr360 prints these names next to these logo codes (verified on the live page).
  مهر: "MEH",
  معراج: "J1",
  "نسیم ایر": "NSN",
  "اطلس ایر": "ATS",
  "فلای کیش": "TKN",
  "آسا جت": "A7",
  "اطلس": "ATS",
  وارش: "VR",
  آوا: "AXV",
  کاسپین: "CPN",
  ترکیش: "TK",
  پگاسوس: "PC",
  "سان اکسپرس": "XQ",
  "فلای دبی": "FZ",
  امارات: "EK",
  قطر: "QR",
  "عمان ایر": "WY",
  لوفت‌هانزا: "LH",
  "اتریش ایرلاینز": "OS",
  العربیه: "G9",
  الجزیره: "J9",
  "سلام ایر": "OV",
  "گلف ایر": "GF",
  "رویال اردنی": "RJ",
  "عراقی ایرویز": "IA",
  ازبکستان: "HY",
  "ایر آستانه": "KC",
  زاگرس: "ZV",
  سما: "SMR",
  "کیش ایر": "Y9",
  "یزد ایر": "UZ",
  "تابان ایر": "TBZ",
  "شیراز ایر": "SHI",
  "فلای پرشیا": "FP",
};

export function normalizeFaName(input: string): string {
  return input
    .replace(/\u200c/g, " ")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const BY_CODE = new Map(LIVE_AIRLINES.map((airline) => [airline.code.toUpperCase(), airline]));
const BY_FA = new Map(Object.entries(FA_TO_CODE).map(([name, code]) => [normalizeFaName(name), code]));

export function getLiveAirline(code: string | null | undefined): LiveAirline | null {
  if (!code) return null;
  return BY_CODE.get(code.toUpperCase().trim()) ?? null;
}

/**
 * Resolve an airline code from two weak signals (logo URL + Persian text).
 * Returns `null` when we cannot confirm a code — the caller then stores the Persian
 * name with `airlineCode: "??"`, which keeps the offer but blocks cross-airline merges.
 */
export function resolveAirlineCode(signals: {
  logoUrl?: string | null;
  nameFa?: string | null;
  nameEn?: string | null;
}): { code: string | null; nameFa: string | null } {
  // 1. Logo file name: ".../airlines/W5.png", ".../W5-2x.png", "...?code=W5".
  const logo = signals.logoUrl ?? "";
  const fromLogo = /([A-Z0-9]{2,3})(?:[-_.@]|\.(?:png|svg|jpe?g|webp))/i.exec(logo.split("/").pop() ?? "");
  if (fromLogo?.[1]) {
    const code = fromLogo[1].toUpperCase();
    const airline = getLiveAirline(code);
    if (airline) return { code: airline.code, nameFa: airline.fa };
  }

  // 2. Persian name, exact after normalisation.
  if (signals.nameFa) {
    const code = BY_FA.get(normalizeFaName(signals.nameFa));
    if (code) return { code, nameFa: getLiveAirline(code)?.fa ?? signals.nameFa };
  }

  // 3. English name, exact (case-insensitive).
  if (signals.nameEn) {
    const wanted = signals.nameEn.toLowerCase().trim();
    const match = LIVE_AIRLINES.find((airline) => airline.en.toLowerCase() === wanted);
    if (match) return { code: match.code, nameFa: match.fa };
  }

  return { code: null, nameFa: signals.nameFa ? normalizeFaName(signals.nameFa) : null };
}

/** Persian label for display; falls back to the source's own text, then to the code. */
export function airlineNameFa(code: string, fallback?: string | null): string {
  return getLiveAirline(code)?.fa ?? (fallback && fallback.trim()) ?? code;
}

export function isKnownAirlineCode(code: string): boolean {
  return BY_CODE.has(code.toUpperCase());
}
