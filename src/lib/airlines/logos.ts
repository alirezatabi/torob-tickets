/**
 * Bundled real airline marks. No logo is generated from a carrier's name or IATA code.
 * Unknown carriers receive a neutral code-only fallback in AirlineLogo.
 *
 * Sources and licence notes are listed here and in docs/airline-logo-sources-fa.md. Airline marks are
 * trademarks; a source-file licence does not transfer ownership of the brand.
 */

export type LogoFormat = "svg" | "png";

export interface AirlineLogoAsset {
  format: LogoFormat;
  source: LogoSource;
}

export type LogoSource =
  | "persian-icons"
  | "soaring-symbols"
  | "airlogos"
  | "zagros-brand"
  | "wikimedia-meraj"
  | "airline-history-mehr"
  | "wikimedia-commons"
  | "airline-history"
  | "airline-logos-aero"
  | "aviation-reference"
  | "unverified-search-result";

export const LOGO_SOURCE_LABEL: Record<LogoSource, string> = {
  "persian-icons": "Persian Icons (MIT icon package; airline mark remains a trademark)",
  "soaring-symbols": "Soaring Symbols (MIT icon package; airline mark remains a trademark)",
  airlogos: "AirLogos (MIT icon package; airline mark remains a trademark)",
  "zagros-brand": "Zagros Airlines brand mark",
  "wikimedia-meraj": "Meraj Airlines logo, Wikimedia Commons (CC BY-SA 3.0)",
  "airline-history-mehr": "Mehr Airways logo shown on AirlineHistory.co.uk; no separate asset licence stated",
  "wikimedia-commons": "Wikimedia Commons file; see docs/airline-logo-sources-fa.md for the individual file and rights note",
  "airline-history": "AirlineHistory.co.uk logo image; no separate asset licence stated",
  "airline-logos-aero": "AirlineLogos.aero logo image; no separate asset licence stated",
  "aviation-reference": "Aviation reference image; no separate asset licence stated",
  "unverified-search-result": "Image search result; original file page and licence not verified (do not use commercially)",
};

const A = (format: LogoFormat, source: LogoSource): AirlineLogoAsset => ({ format, source });

/** Canonical carrier code → authentic, bundled mark. */
export const AIRLINE_LOGO_ASSETS: Record<string, AirlineLogoAsset> = {
  // Iran
  FP: A("png", "unverified-search-result"), // FlyPersia — visual identity matched, but source-file page/licence is unverified
  AXV: A("png", "wikimedia-commons"), // Ava Airlines (ICAO AXV; CC0 file)
  A7: A("png", "aviation-reference"), // Asa Jet — source feed code; not asserted as IATA
  NSN: A("png", "airline-history"), // Nasim Air
  IRZ: A("png", "airline-history"), // Saha Airlines (ICAO IRZ)
  CPN: A("png", "airline-logos-aero"), // Caspian Airlines
  NV: A("png", "wikimedia-commons"), // Karun Airlines (IATA NV)
  I3: A("png", "wikimedia-commons"), // ATA Airlines
  DZD: A("png", "wikimedia-commons"), // Yazd Airways
  IR: A("svg", "persian-icons"), // Iran Air — Homa
  W5: A("svg", "persian-icons"), // Mahan Air
  Y9: A("svg", "persian-icons"), // Kish Air
  B9: A("svg", "persian-icons"), // Iran Airtour — Simorgh
  ZV: A("png", "zagros-brand"), // Zagros Airlines
  EP: A("svg", "persian-icons"), // Iran Aseman
  IJ: A("png", "wikimedia-meraj"), // Meraj Airlines (IATA IJ)
  MEH: A("png", "airline-history-mehr"), // Mehr Airways (ICAO MEH; no IATA code assigned)
  // Türkiye
  TK: A("svg", "soaring-symbols"),
  PC: A("svg", "soaring-symbols"),
  XQ: A("png", "airlogos"),
  // Gulf
  FZ: A("svg", "airlogos"),
  EK: A("svg", "soaring-symbols"),
  QR: A("svg", "soaring-symbols"),
  WY: A("svg", "soaring-symbols"),
  G9: A("svg", "soaring-symbols"),
  J9: A("svg", "airlogos"),
  OV: A("svg", "airlogos"),
  GF: A("svg", "airlogos"),
  RJ: A("svg", "airlogos"),
  // Wider region / Europe
  LH: A("svg", "soaring-symbols"),
  OS: A("svg", "soaring-symbols"),
  HY: A("png", "airlogos"),
  KC: A("svg", "soaring-symbols"),
  IA: A("png", "airlogos"),
};

/** Codes seen in feeds that refer to an already-catalogued airline. */
const CODE_ALIASES: Record<string, string> = {
  JI: "IJ", // legacy source spelling for Meraj
  MRJ: "IJ", // ICAO code for Meraj
  SAH: "IRZ", // legacy/source alias for Saha (ICAO IRZ)
  IV: "CPN", // Caspian Airlines IATA code
  SEP: "IS", // observed alternate code for Sepehran
  KRN: "NV", // observed alternate code for Karun
  VRS: "VR", // observed alternate code for Varesh
  UZ: "DZD", // observed alternate code for Yazd Airways
};

const NAME_ALIASES: Record<string, string> = {
  flypersia: "FP",
  فلایپرشیا: "FP",
  ava: "AXV",
  avairlines: "AXV",
  آوا: "AXV",
  asajet: "A7",
  آسا: "A7",
  آساجت: "A7",
  varesh: "VR",
  vareshairlines: "VR",
  وارش: "VR",
  nasim: "NSN",
  nasimair: "NSN",
  نسیم: "NSN",
  نسیمایر: "NSN",
  saha: "IRZ",
  sahairlines: "IRZ",
  ساها: "IRZ",
  caspian: "CPN",
  caspianairlines: "CPN",
  کاسپین: "CPN",
  sepehran: "IS",
  sepehranairlines: "IS",
  سپهران: "IS",
  ata: "I3",
  atairlines: "I3",
  آتا: "I3",
  karun: "NV",
  karunairlines: "NV",
  کارون: "NV",
  yazd: "DZD",
  yazdair: "DZD",
  yazdairways: "DZD",
  یزد: "DZD",
  یزدایر: "DZD",
  flykish: "TKN",
  "fly kish": "TKN",
  "فلای کیش": "TKN",
  فلایکیش: "TKN",
  atlasair: "ATS",
  اطلس: "ATS",
  اطلسایر: "ATS",
};

function normalizedName(value: string): string {
  return value.toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[^a-z0-9\u0600-\u06ff]/g, "");
}

function normalizedNameWords(value: string): string {
  return value
    .toLowerCase()
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .trim();
}

/** Resolve common name/code variants without ever fabricating a visual brand mark. */
export function canonicalAirlineCode(code: string, airlineName?: string): string {
  const name = normalizedName(airlineName ?? "");
  const words = normalizedNameWords(airlineName ?? "");
  if (name.includes("meraj") || name.includes("معراج")) return "IJ";
  if (name.includes("mehr") || name.includes("مهر")) return "MEH";
  for (const [alias, canonical] of Object.entries(NAME_ALIASES)) {
    const compactAlias = normalizedName(alias);
    const wordAlias = normalizedNameWords(alias);
    if (
      name === compactAlias ||
      (wordAlias.length > 2 && new RegExp(`(^|\\s)${wordAlias}(?=\\s|$)`).test(words))
    ) {
      return canonical;
    }
  }
  const upper = code.trim().toUpperCase();
  return CODE_ALIASES[upper] ?? upper;
}

/** The public path for a bundled authentic logo, or null when we have no real logo. */
export function airlineLogoPath(code: string, airlineName?: string): string | null {
  const canonicalCode = canonicalAirlineCode(code, airlineName);
  const asset = AIRLINE_LOGO_ASSETS[canonicalCode];
  return asset ? `/airline-logos/${canonicalCode}.${asset.format}` : null;
}

export const AIRLINES_WITH_REAL_LOGO = Object.keys(AIRLINE_LOGO_ASSETS);
