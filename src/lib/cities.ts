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
  /** Rough coordinates, used for the route-map decoration (no map tile service). */
  lat: number;
  lon: number;
  /** Featured on the homepage as a quick-pick destination. */
  popular?: boolean;
}

/**
 * Curated airport catalogue for the demo.
 *
 * Iran-centric (domestic + the outbound routes Iranians actually fly) plus the
 * main Gulf/Europe/Turkey hubs. Codes are IATA.
 */
export const CITIES: City[] = [
  // ——— Iran ———
  {
    code: "THR",
    fa: "تهران",
    en: "Tehran",
    country: "IR",
    countryFa: "ایران",
    airportFa: "فرودگاه امام خمینی",
    aliases: ["تهران", "tehran", "thr", "ایکا", "امام خمینی", "ikia"],
    timezone: "Asia/Tehran",
    lat: 35.69,
    lon: 51.39,
    popular: true,
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
    lat: 36.23,
    lon: 59.64,
    popular: true,
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
    lat: 29.54,
    lon: 52.59,
    popular: true,
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
    lat: 32.75,
    lon: 51.86,
    popular: true,
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
    lat: 38.13,
    lon: 46.24,
  },
  {
    code: "KIH",
    fa: "کیش",
    en: "Kish",
    country: "IR",
    countryFa: "ایران",
    airportFa: "فرودگاه کیش",
    aliases: ["کیش", "kish", "kih"],
    timezone: "Asia/Tehran",
    lat: 26.53,
    lon: 53.98,
    popular: true,
  },
  {
    code: "AWZ",
    fa: "اهواز",
    en: "Ahvaz",
    country: "IR",
    countryFa: "ایران",
    airportFa: "فرودگاه اهواز",
    aliases: ["اهواز", "ahvaz", "awz"],
    timezone: "Asia/Tehran",
    lat: 31.34,
    lon: 48.76,
  },
  {
    code: "BND",
    fa: "بندرعباس",
    en: "Bandar Abbas",
    country: "IR",
    countryFa: "ایران",
    airportFa: "فرودگاه بین‌المللی بندرعباس",
    aliases: ["بندرعباس", "بندر عباس", "bandar abbas", "bnd"],
    timezone: "Asia/Tehran",
    lat: 27.22,
    lon: 56.38,
  },
  {
    code: "GSM",
    fa: "قشم",
    en: "Qeshm",
    country: "IR",
    countryFa: "ایران",
    airportFa: "فرودگاه قشم",
    aliases: ["قشم", "qeshm", "gsm"],
    timezone: "Asia/Tehran",
    lat: 26.75,
    lon: 55.9,
  },
  {
    code: "RAS",
    fa: "رشت",
    en: "Rasht",
    country: "IR",
    countryFa: "ایران",
    airportFa: "فرودگاه سردار جنگل",
    aliases: ["رشت", "rasht", "ras"],
    timezone: "Asia/Tehran",
    lat: 37.32,
    lon: 49.61,
  },
  {
    code: "KER",
    fa: "کرمان",
    en: "Kerman",
    country: "IR",
    countryFa: "ایران",
    airportFa: "فرودگاه کرمان",
    aliases: ["کرمان", "kerman", "ker"],
    timezone: "Asia/Tehran",
    lat: 30.27,
    lon: 57.0,
  },
  {
    code: "ZAH",
    fa: "زاهدان",
    en: "Zahedan",
    country: "IR",
    countryFa: "ایران",
    airportFa: "فرودگاه زاهدان",
    aliases: ["زاهدان", "zahedan", "zah"],
    timezone: "Asia/Tehran",
    lat: 29.48,
    lon: 60.9,
  },
  {
    code: "OMH",
    fa: "ارومیه",
    en: "Urmia",
    country: "IR",
    countryFa: "ایران",
    airportFa: "فرودگاه ارومیه",
    aliases: ["ارومیه", "urmia", "omh"],
    timezone: "Asia/Tehran",
    lat: 37.67,
    lon: 45.07,
  },
  {
    code: "AZD",
    fa: "یزد",
    en: "Yazd",
    country: "IR",
    countryFa: "ایران",
    airportFa: "فرودگاه شهید صدوقی",
    aliases: ["یزد", "yazd", "azd"],
    timezone: "Asia/Tehran",
    lat: 31.9,
    lon: 54.28,
  },
  // ——— Turkey ———
  {
    code: "IST",
    fa: "استانبول",
    en: "Istanbul",
    country: "TR",
    countryFa: "ترکیه",
    airportFa: "فرودگاه استانبول",
    aliases: ["استانبول", "istanbul", "ist", "استامبول", "اسطانبول"],
    timezone: "Europe/Istanbul",
    lat: 41.28,
    lon: 28.75,
    popular: true,
  },
  {
    code: "SAW",
    fa: "استانبول (صبیحا)",
    en: "Istanbul Sabiha",
    country: "TR",
    countryFa: "ترکیه",
    airportFa: "فرودگاه صبیحا گوکچن",
    aliases: ["صبیحا", "sabiha", "saw"],
    timezone: "Europe/Istanbul",
    lat: 40.9,
    lon: 29.31,
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
    lat: 36.9,
    lon: 30.8,
    popular: true,
  },
  {
    code: "ADB",
    fa: "ازمیر",
    en: "Izmir",
    country: "TR",
    countryFa: "ترکیه",
    airportFa: "فرودگاه عدنان مندرس",
    aliases: ["ازمیر", "izmir", "adb"],
    timezone: "Europe/Istanbul",
    lat: 38.29,
    lon: 27.16,
  },
  // ——— Gulf ———
  {
    code: "DXB",
    fa: "دبی",
    en: "Dubai",
    country: "AE",
    countryFa: "امارات",
    airportFa: "فرودگاه دبی",
    aliases: ["دبی", "dubai", "dxb"],
    timezone: "Asia/Dubai",
    lat: 25.25,
    lon: 55.36,
    popular: true,
  },
  {
    code: "SHJ",
    fa: "شارجه",
    en: "Sharjah",
    country: "AE",
    countryFa: "امارات",
    airportFa: "فرودگاه شارجه",
    aliases: ["شارجه", "sharjah", "shj"],
    timezone: "Asia/Dubai",
    lat: 25.33,
    lon: 55.52,
  },
  {
    code: "DOH",
    fa: "دوحه",
    en: "Doha",
    country: "QA",
    countryFa: "قطر",
    airportFa: "فرودگاه حمد",
    aliases: ["دوحه", "doha", "doh"],
    timezone: "Asia/Qatar",
    lat: 25.27,
    lon: 51.61,
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
    lat: 23.6,
    lon: 58.28,
  },
  {
    code: "KWI",
    fa: "کویت",
    en: "Kuwait",
    country: "KW",
    countryFa: "کویت",
    airportFa: "فرودگاه کویت",
    aliases: ["کویت", "kuwait", "kwi"],
    timezone: "Asia/Kuwait",
    lat: 29.23,
    lon: 47.97,
  },
  {
    code: "RUH",
    fa: "ریاض",
    en: "Riyadh",
    country: "SA",
    countryFa: "عربستان",
    airportFa: "فرودگاه ملک خالد",
    aliases: ["ریاض", "riyadh", "ruh"],
    timezone: "Asia/Riyadh",
    lat: 24.96,
    lon: 46.7,
  },
  {
    code: "JED",
    fa: "جده",
    en: "Jeddah",
    country: "SA",
    countryFa: "عربستان",
    airportFa: "فرودگاه ملک عبدالعزیز",
    aliases: ["جده", "jeddah", "jed"],
    timezone: "Asia/Riyadh",
    lat: 21.68,
    lon: 39.16,
  },
  // ——— Iraq / Levant (ziyarat + medical travel) ———
  {
    code: "NJF",
    fa: "نجف",
    en: "Najaf",
    country: "IQ",
    countryFa: "عراق",
    airportFa: "فرودگاه نجف",
    aliases: ["نجف", "najaf", "njf"],
    timezone: "Asia/Baghdad",
    lat: 31.99,
    lon: 44.4,
    popular: true,
  },
  {
    code: "BGW",
    fa: "بغداد",
    en: "Baghdad",
    country: "IQ",
    countryFa: "عراق",
    airportFa: "فرودگاه بغداد",
    aliases: ["بغداد", "baghdad", "bgw"],
    timezone: "Asia/Baghdad",
    lat: 33.26,
    lon: 44.23,
  },
  {
    code: "KIK",
    fa: "کربلا",
    en: "Karbala",
    country: "IQ",
    countryFa: "عراق",
    airportFa: "فرودگاه کربلا",
    aliases: ["کربلا", "karbala", "kik"],
    timezone: "Asia/Baghdad",
    lat: 32.62,
    lon: 44.02,
  },
  {
    code: "DAM",
    fa: "دمشق",
    en: "Damascus",
    country: "SY",
    countryFa: "سوریه",
    airportFa: "فرودگاه دمشق",
    aliases: ["دمشق", "damascus", "dam"],
    timezone: "Asia/Damascus",
    lat: 33.41,
    lon: 36.52,
  },
  {
    code: "BEY",
    fa: "بیروت",
    en: "Beirut",
    country: "LB",
    countryFa: "لبنان",
    airportFa: "فرودگاه بیروت",
    aliases: ["بیروت", "beirut", "bey"],
    timezone: "Asia/Beirut",
    lat: 33.82,
    lon: 35.49,
  },
  // ——— Caucasus / Central Asia ———
  {
    code: "EVN",
    fa: "ایروان",
    en: "Yerevan",
    country: "AM",
    countryFa: "ارمنستان",
    airportFa: "فرودگاه زوارتنوتس",
    aliases: ["ایروان", "yerevan", "evn"],
    timezone: "Asia/Yerevan",
    lat: 40.15,
    lon: 44.4,
  },
  {
    code: "TBS",
    fa: "تفلیس",
    en: "Tbilisi",
    country: "GE",
    countryFa: "گرجستان",
    airportFa: "فرودگاه تفلیس",
    aliases: ["تفلیس", "tbilisi", "tbs"],
    timezone: "Asia/Tbilisi",
    lat: 41.67,
    lon: 44.95,
  },
  {
    code: "GYD",
    fa: "باکو",
    en: "Baku",
    country: "AZ",
    countryFa: "آذربایجان",
    airportFa: "فرودگاه حیدر علی‌اف",
    aliases: ["باکو", "baku", "gyd"],
    timezone: "Asia/Baku",
    lat: 40.47,
    lon: 50.05,
  },
  {
    code: "ASB",
    fa: "عشق‌آباد",
    en: "Ashgabat",
    country: "TM",
    countryFa: "ترکمنستان",
    airportFa: "فرودگاه عشق‌آباد",
    aliases: ["عشق‌آباد", "ashgabat", "asb"],
    timezone: "Asia/Ashgabat",
    lat: 37.99,
    lon: 58.36,
  },
  {
    code: "TAS",
    fa: "تاشکند",
    en: "Tashkent",
    country: "UZ",
    countryFa: "ازبکستان",
    airportFa: "فرودگاه تاشکند",
    aliases: ["تاشکند", "tashkent", "tas"],
    timezone: "Asia/Tashkent",
    lat: 41.26,
    lon: 69.28,
  },
  // ——— South Asia (medical tourism) ———
  {
    code: "DEL",
    fa: "دهلی",
    en: "Delhi",
    country: "IN",
    countryFa: "هند",
    airportFa: "فرودگاه ایندیرا گاندی",
    aliases: ["دهلی", "delhi", "del", "دهلی نو"],
    timezone: "Asia/Kolkata",
    lat: 28.56,
    lon: 77.1,
  },
  {
    code: "BOM",
    fa: "بمبئی",
    en: "Mumbai",
    country: "IN",
    countryFa: "هند",
    airportFa: "فرودگاه چتراپاتی شیواجی",
    aliases: ["بمبئی", "mumbai", "bom", "بومبای"],
    timezone: "Asia/Kolkata",
    lat: 19.09,
    lon: 72.87,
  },
  {
    code: "KHI",
    fa: "کراچی",
    en: "Karachi",
    country: "PK",
    countryFa: "پاکستان",
    airportFa: "فرودگاه جناح",
    aliases: ["کراچی", "karachi", "khi"],
    timezone: "Asia/Karachi",
    lat: 24.91,
    lon: 67.16,
  },
  // ——— Europe ———
  {
    code: "FRA",
    fa: "فرانکفورت",
    en: "Frankfurt",
    country: "DE",
    countryFa: "آلمان",
    airportFa: "فرودگاه فرانکفورت",
    aliases: ["فرانکفورت", "frankfurt", "fra"],
    timezone: "Europe/Berlin",
    lat: 50.04,
    lon: 8.56,
    popular: true,
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
    lat: 52.36,
    lon: 13.5,
  },
  {
    code: "MUC",
    fa: "مونیخ",
    en: "Munich",
    country: "DE",
    countryFa: "آلمان",
    airportFa: "فرودگاه مونیخ",
    aliases: ["مونیخ", "munich", "muc"],
    timezone: "Europe/Berlin",
    lat: 48.35,
    lon: 11.79,
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
    lat: 51.47,
    lon: -0.45,
    popular: true,
  },
  {
    code: "CDG",
    fa: "پاریس",
    en: "Paris",
    country: "FR",
    countryFa: "فرانسه",
    airportFa: "فرودگاه شارل دوگل",
    aliases: ["پاریس", "paris", "cdg"],
    timezone: "Europe/Paris",
    lat: 49.01,
    lon: 2.55,
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
    lat: 52.31,
    lon: 4.76,
  },
  {
    code: "VIE",
    fa: "وین",
    en: "Vienna",
    country: "AT",
    countryFa: "اتریش",
    airportFa: "فرودگاه وین",
    aliases: ["وین", "vienna", "vie"],
    timezone: "Europe/Vienna",
    lat: 48.11,
    lon: 16.57,
  },
  {
    code: "ARN",
    fa: "استکهلم",
    en: "Stockholm",
    country: "SE",
    countryFa: "سوئد",
    airportFa: "فرودگاه آرلاندا",
    aliases: ["استکهلم", "stockholm", "arn"],
    timezone: "Europe/Stockholm",
    lat: 59.65,
    lon: 17.92,
  },
  {
    code: "FCO",
    fa: "رم",
    en: "Rome",
    country: "IT",
    countryFa: "ایتالیا",
    airportFa: "فرودگاه فیومیچینو",
    aliases: ["rome", "fco"],
    timezone: "Europe/Rome",
    lat: 41.8,
    lon: 12.25,
  },
];

export const CITY_LIST: City[] = CITIES;

const BY_CODE = new Map(CITIES.map((city) => [city.code, city]));

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

export function popularCities(): City[] {
  return CITIES.filter((city) => city.popular);
}

/**
 * Persian has no word boundaries, so a short alias like "رم" (Rome) also appears
 * inside unrelated words ("بـرم" in "می‌خوام برم کیش"). Persian parts of speech are
 * space separated, so a match only counts when it stands on its own: the
 * neighbouring characters must not be letters of either script. Latin aliases are
 * checked the same way so "saw" no longer matches inside "lawsuit".
 */
const LETTER = /[a-z0-9\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF]/i;

const aliasMatches = (haystack: string, needle: string): boolean => {
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) return false;
    const before = index === 0 ? "" : haystack[index - 1]!;
    const after = haystack[index + needle.length] ?? "";
    if (!LETTER.test(before) && !LETTER.test(after)) return true;
    from = index + 1;
  }
};

/** First standalone occurrence of an alias, or -1. */
const aliasIndex = (haystack: string, needle: string): number => {
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) return -1;
    const before = index === 0 ? "" : haystack[index - 1]!;
    const after = haystack[index + needle.length] ?? "";
    if (!LETTER.test(before) && !LETTER.test(after)) return index;
    from = index + 1;
  }
};

/** Resolve free text to a city code. Longest alias wins ("استانبول صبیحا" > "استانبول"). */
export function findCityInText(text: string): string | null {
  const haystack = text.toLowerCase();
  let best: { code: string; length: number } | null = null;

  for (const city of CITIES) {
    for (const alias of [city.fa, city.en, city.code, ...city.aliases]) {
      const needle = alias.toLowerCase().trim();
      if (needle.length < 2) continue;
      if (!aliasMatches(haystack, needle)) continue;
      if (!best || needle.length > best.length) best = { code: city.code, length: needle.length };
    }
  }
  return best?.code ?? null;
}

/** All city mentions in order of appearance (used by the NL route parser). */
export function findCitiesInOrder(text: string): { code: string; index: number }[] {
  const haystack = text.toLowerCase();
  const found: { code: string; index: number; length: number }[] = [];

  for (const city of CITIES) {
    let bestIndex = Number.POSITIVE_INFINITY;
    let bestLength = 0;
    for (const alias of [city.fa, city.en, city.code, ...city.aliases]) {
      const needle = alias.toLowerCase().trim();
      if (needle.length < 2) continue;
      const index = aliasIndex(haystack, needle);
      if (index === -1) continue;
      if (index < bestIndex || (index === bestIndex && needle.length > bestLength)) {
        bestIndex = index;
        bestLength = needle.length;
      }
    }
    if (Number.isFinite(bestIndex)) found.push({ code: city.code, index: bestIndex, length: bestLength });
  }

  // Longest alias first so a city is not double-counted inside a longer name.
  return found
    .sort((a, b) => a.index - b.index || b.length - a.length)
    .filter((entry, index, array) => array.findIndex((other) => other.code === entry.code) === index)
    .map(({ code, index }) => ({ code, index }));
}
