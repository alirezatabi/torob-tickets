/**
 * Bundled real airline marks. No logo is generated from a carrier's name or IATA code.
 * Unknown carriers receive a neutral code-only fallback in AirlineLogo.
 *
 * Sources and licence notes are listed here and in docs/REPORT-02.md §۱۱. Airline marks are
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
  | "airline-history-mehr";

export const LOGO_SOURCE_LABEL: Record<LogoSource, string> = {
  "persian-icons": "Persian Icons (MIT icon package; airline mark remains a trademark)",
  "soaring-symbols": "Soaring Symbols (MIT icon package; airline mark remains a trademark)",
  airlogos: "AirLogos (MIT icon package; airline mark remains a trademark)",
  "zagros-brand": "Zagros Airlines brand mark",
  "wikimedia-meraj": "Meraj Airlines logo, Wikimedia Commons (CC BY-SA 3.0)",
  "airline-history-mehr": "Mehr Airways logo shown on AirlineHistory.co.uk; no separate asset licence stated",
};

const A = (format: LogoFormat, source: LogoSource): AirlineLogoAsset => ({ format, source });

/** Canonical carrier code → authentic, bundled mark. */
export const AIRLINE_LOGO_ASSETS: Record<string, AirlineLogoAsset> = {
  // Iran
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
};

function normalizedName(value: string): string {
  return value.toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[^a-z0-9\u0600-\u06ff]/g, "");
}

/** Resolve common name/code variants without ever fabricating a visual brand mark. */
export function canonicalAirlineCode(code: string, airlineName?: string): string {
  const name = normalizedName(airlineName ?? "");
  if (name.includes("meraj") || name.includes("معراج")) return "IJ";
  if (name.includes("mehr") || name.includes("مهر")) return "MEH";
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
