/**
 * The real, official-looking marks of the carriers in this demo.
 *
 * Each file in `./logos/` is that airline's own logo, bundled with the repo so the app keeps
 * working with no network at all — it is served from `/airline-logos/<CODE>.<ext>` by a tiny
 * route handler, never from a CDN.
 *
 * Provenance and licences are recorded in `SOURCES` below and in `docs/REPORT-02.md` §۹.
 * Every file was re-cropped onto a square canvas so a row of rows reads as one column of
 * equally sized marks; the artwork itself is untouched.
 */

export type LogoFormat = "svg" | "png";

export interface AirlineLogoAsset {
  /** File extension — SVG scales, PNG is a raster fallback for carriers with no vector mark. */
  format: LogoFormat;
  /** Where the artwork came from, for the licence note in the UI and the report. */
  source: LogoSource;
}

export type LogoSource = "persian-icons" | "soaring-symbols" | "airlogos" | "zagros-brand";

/** Human-readable credit lines; the footer and the docs cite these verbatim. */
export const LOGO_SOURCE_LABEL: Record<LogoSource, string> = {
  "persian-icons": "Persian Icons (MIT)",
  "soaring-symbols": "Soaring Symbols (MIT)",
  airlogos: "AirLogos (MIT)",
  "zagros-brand": "Zagros Airlines brand mark",
};

const A = (format: LogoFormat, source: LogoSource): AirlineLogoAsset => ({ format, source });

/**
 * 23 carriers, one mark each. Anything not listed here falls back to the drawn badge in
 * `brand.ts`, so an unknown code still gets a stable, non-empty identity.
 */
export const AIRLINE_LOGO_ASSETS: Record<string, AirlineLogoAsset> = {
  // ——— Iran ———
  IR: A("svg", "persian-icons"), // Iran Air — Homa
  W5: A("svg", "persian-icons"), // Mahan Air
  Y9: A("svg", "persian-icons"), // Kish Air
  B9: A("svg", "persian-icons"), // Iran Airtour — Simorgh
  ZV: A("png", "zagros-brand"), // Zagros Airlines — falcon (brand mark, no permissive vector)
  EP: A("svg", "persian-icons"), // Iran Aseman
  // ——— Türkiye ———
  TK: A("svg", "soaring-symbols"),
  PC: A("svg", "soaring-symbols"),
  XQ: A("png", "airlogos"),
  // ——— Gulf ———
  FZ: A("svg", "airlogos"),
  EK: A("svg", "soaring-symbols"),
  QR: A("svg", "soaring-symbols"),
  WY: A("svg", "soaring-symbols"),
  G9: A("svg", "soaring-symbols"),
  J9: A("svg", "airlogos"),
  OV: A("svg", "airlogos"),
  GF: A("svg", "airlogos"),
  RJ: A("svg", "airlogos"),
  // ——— Wider region / Europe ———
  LH: A("svg", "soaring-symbols"),
  OS: A("svg", "soaring-symbols"),
  HY: A("png", "airlogos"),
  KC: A("svg", "soaring-symbols"),
  IA: A("png", "airlogos"),
};

/** The public path the logo for `code` is served from, or `null` when we have no real mark. */
export function airlineLogoPath(code: string): string | null {
  const asset = AIRLINE_LOGO_ASSETS[code.toUpperCase()];
  return asset ? `/airline-logos/${code.toUpperCase()}.${asset.format}` : null;
}

/** Codes that carry a bundled real logo — used by the docs test to keep the two in sync. */
export const AIRLINES_WITH_REAL_LOGO = Object.keys(AIRLINE_LOGO_ASSETS);
