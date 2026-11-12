export interface City {
  code: string;
  fa: string;
  en: string;
  country: string;
  countryFa: string;
  airportFa: string;
  /** Common Persian/English aliases used by the NL parser. */
  aliases: string[];
  timezone: string;
}

/**
 * The demo dataset is Iran-centric, so cities are curated rather than exhaustive.
 * Codes are IATA airport codes (a city with one main airport maps 1:1).
 */
export const CITIES: City[] = [
  {
    code: "THR",
    fa: "تهران",
    en: "Tehran",
    country: "IR",
    countryFa: "ایران",
    airportFa: "فرودگاه امام خمینی",
    aliases: ["تهران", "tehran", "thr", "یکا", "امام خمینی", "ikia"],
    timezone: "Asia/Tehran",
  },
  {
    code: "IST",
    fa: "استانبول",
    en: "Istanbul",
    country: "TR",
    countryFa: "ترکیه",
    airportFa: "فرودگاه استانبول",
    aliases: ["استانبول", "istanbul", "ist", "استامبول", "اسطانبول"],
    timezone: "Europe/Istanbul",
  },
  {
    code: "SAW",
    fa: "استانبول (صبیحا)",
    en: "Istanbul Sabiha",
    country: "TR",
    countryFa: "ترکیه",
    airportFa: "فرودگاه صبیحا گوکچن",
    aliases: ["صبیحا", "sabiha", "saw", "استانبول صبیحا"],
    timezone: "Europe/Istanbul",
  },
  {
    code: "DXB",
    fa: "دبی",
    en: "Dubai",
    country: "AE",
    countryFa: "امارات",
    airportFa: "فرودگاه دبی",
    aliases: ["دبی", "dubai", "dxb"],
    timezone: "Asia/Dubai",
  },
  {
    code: "MCT",
    fa: "مسقط",
    en: "Muscat",
    country: "OM",
    countryFa: "عمان",
    airportFa: "فرودگاه مسقط",
    aliases: ["مسقط", "muscat", "mct"],
    timezone: "Asia/Muscat",
  },
  {
    code: "MHD",
    fa: "مشهد",
    en: "Mashhad",
    country: "IR",
    countryFa: "ایران",
    airportFa: "فرودگاه هاشمی‌نژاد",
    aliases: ["مشهد", "mashhad", "mhd"],
    timezone: "Asia/Tehran",
  },
  {
    code: "SYZ",
    fa: "شیراز",
    en: "Shiraz",
    country: "IR",
    countryFa: "ایران",
    airportFa: "فرودگاه بین‌المللی شیراز",
    aliases: ["شیراز", "shiraz", "syz"],
    timezone: "Asia/Tehran",
  },
  {
    code: "IFN",
    fa: "اصفهان",
    en: "Isfahan",
    country: "IR",
    countryFa: "ایران",
    airportFa: "فرودگاه شهید بهشتی",
    aliases: ["اصفهان", "isfahan", "ifn", "اسفهان"],
    timezone: "Asia/Tehran",
  },
  {
    code: "TBZ",
    fa: "تبریز",
    en: "Tabriz",
    country: "IR",
    countryFa: "ایران",
    airportFa: "فرودگاه شهید مدنی",
    aliases: ["تبریز", "tabriz", "tbz"],
    timezone: "Asia/Tehran",
  },
  {
    code: "NJF",
    fa: "نجف",
    en: "Najaf",
    country: "IQ",
    countryFa: "عراق",
    airportFa: "فرودگاه نجف",
    aliases: ["نجف", "najaf", "njf"],
    timezone: "Asia/Baghdad",
  },
  {
    code: "BER",
    fa: "برلین",
    en: "Berlin",
    country: "DE",
    countryFa: "آلمان",
    airportFa: "فرودگاه براندنبورگ",
    aliases: ["برلین", "berlin", "ber"],
    timezone: "Europe/Berlin",
  },
  {
    code: "FRA",
    fa: "فرانکفورت",
    en: "Frankfurt",
    country: "DE",
    countryFa: "آلمان",
    airportFa: "فرودگاه فرانکفورت",
    aliases: ["فرانکفورت", "frankfurt", "fra"],
    timezone: "Europe/Berlin",
  },
  {
    code: "LHR",
    fa: "لندن",
    en: "London",
    country: "GB",
    countryFa: "انگلستان",
    airportFa: "فرودگاه هیثرو",
    aliases: ["لندن", "london", "lhr", "هیثرو"],
    timezone: "Europe/London",
  },
  {
    code: "AMS",
    fa: "آمستردام",
    en: "Amsterdam",
    country: "NL",
    countryFa: "هلند",
    airportFa: "فرودگاه اسخیپهول",
    aliases: ["آمستردام", "amsterdam", "ams"],
    timezone: "Europe/Amsterdam",
  },
  {
    code: "AYT",
    fa: "آنتالیا",
    en: "Antalya",
    country: "TR",
    countryFa: "ترکیه",
    airportFa: "فرودگاه آنتالیا",
    aliases: ["آنتالیا", "antalya", "ayt"],
    timezone: "Europe/Istanbul",
  },
];

const BY_CODE = new Map(CITIES.map((c) => [c.code, c]));

export function getCity(code: string): City | null {
  return BY_CODE.get(code.toUpperCase()) ?? null;
}

export function cityLabel(code: string): string {
  const city = getCity(code);
  return city ? `${city.fa} (${city.code})` : code;
}

export function airportLabel(code: string): string {
  return getCity(code)?.airportFa ?? code;
}

/** Cities that have demo data, used to validate search input. */
export function isKnownCity(code: string): boolean {
  return BY_CODE.has(code.toUpperCase());
}

/**
 * Resolve free text to a city code. Matches Persian/English names and IATA-ish
 * tokens; the longest alias wins so "استانبول صبیحا" beats "استانبول".
 */
export function findCityInText(text: string): string | null {
  const haystack = text.toLowerCase();
  let best: { code: string; length: number } | null = null;

  for (const city of CITIES) {
    for (const alias of [city.fa, city.en, city.code, ...city.aliases]) {
      const needle = alias.toLowerCase();
      if (needle.length < 2) continue;
      if (haystack.includes(needle) && (!best || needle.length > best.length)) {
        best = { code: city.code, length: needle.length };
      }
    }
  }
  return best?.code ?? null;
}
