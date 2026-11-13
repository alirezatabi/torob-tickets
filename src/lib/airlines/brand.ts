/**
 * Visual identity for each airline in the demo.
 *
 * A price comparison is scanned by *carrier* before it is read: the eye finds “the Iran Air
 * one” long before it parses a flight number. So every row carries a badge in that carrier's
 * own livery colours, with a distinct emblem, instead of the two grey letters we had.
 *
 * Honesty note: these are **hand-drawn marks built for this demo**, not the airlines'
 * registered logos (those are trademarks and are not shipped here). They are labelled as such
 * in the UI, and they never carry a price or a claim — only identity.
 */

export type Emblem =
  | "wing"
  | "star"
  | "crescent"
  | "tulip"
  | "swirl"
  | "falcon"
  | "sun"
  | "wave"
  | "kite"
  | "crown"
  | "swan";

export interface AirlineBrand {
  /** Gradient stops of the badge, in the carrier's livery colours. */
  from: string;
  to: string;
  emblem: Emblem;
}

const BRANDS: Record<string, AirlineBrand> = {
  // ——— Iran ———
  IR: { from: "#0b4f8a", to: "#062f57", emblem: "falcon" }, // Iran Air — navy
  W5: { from: "#2b6cb0", to: "#12335c", emblem: "wing" }, // Mahan Air — blue
  Y9: { from: "#0f8a78", to: "#065f52", emblem: "wave" }, // Kish Air — teal
  B9: { from: "#f08300", to: "#b45309", emblem: "sun" }, // Iran Airtour — orange
  ZV: { from: "#3f9142", to: "#1f5a2a", emblem: "kite" }, // Zagros — green
  EP: { from: "#3a7bd5", to: "#1b3f7a", emblem: "crown" }, // Aseman — blue
  // ——— Türkiye ———
  TK: { from: "#d81e3f", to: "#8f0f26", emblem: "tulip" }, // Turkish Airlines — red
  PC: { from: "#f7c948", to: "#d99e0b", emblem: "star" }, // Pegasus — yellow
  XQ: { from: "#e2622a", to: "#9c3410", emblem: "sun" }, // SunExpress — orange
  // ——— Gulf ———
  FZ: { from: "#e8542f", to: "#0b2f6b", emblem: "wave" }, // flydubai — orange/blue
  EK: { from: "#c8102e", to: "#7d071a", emblem: "falcon" }, // Emirates — red
  QR: { from: "#5c0632", to: "#340220", emblem: "crescent" }, // Qatar Airways — maroon
  WY: { from: "#00857d", to: "#004d49", emblem: "swirl" }, // Oman Air — teal
  G9: { from: "#e01b24", to: "#8c0e14", emblem: "kite" }, // Air Arabia — red
  J9: { from: "#0f6bbd", to: "#083d70", emblem: "crown" }, // Jazeera — blue
  OV: { from: "#f47b20", to: "#a84a06", emblem: "crescent" }, // SalamAir — orange
  GF: { from: "#b8963e", to: "#7a5f1c", emblem: "falcon" }, // Gulf Air — gold
  RJ: { from: "#0b5fa5", to: "#073b68", emblem: "crown" }, // Royal Jordanian — blue
  // ——— Wider region / Europe ———
  LH: { from: "#1b3a6b", to: "#0a1f42", emblem: "swirl" }, // Lufthansa — navy
  OS: { from: "#c8102e", to: "#7d071a", emblem: "swan" }, // Austrian — red
  HY: { from: "#009639", to: "#005a22", emblem: "star" }, // Uzbekistan Airways
  KC: { from: "#00a3ad", to: "#00666d", emblem: "sun" }, // Air Astana — teal
  IA: { from: "#007a33", to: "#00451c", emblem: "wing" }, // Iraqi Airways — green
};

/** A stable, pleasant gradient for any carrier this build has never heard of. */
const FALLBACKS: Omit<AirlineBrand, "emblem">[] = [
  { from: "#3a4a67", to: "#1a2436" },
  { from: "#0f8a78", to: "#0a4d47" },
  { from: "#b45309", to: "#7c3a06" },
  { from: "#5b6b86", to: "#22304a" },
];
const EMBLEMS: Emblem[] = ["wing", "star", "kite", "swirl", "crown", "sun"];

/** Code point sum — deterministic, so an unknown carrier keeps the same badge forever. */
function seed(code: string): number {
  let sum = 0;
  for (let index = 0; index < code.length; index += 1) sum += code.charCodeAt(index) * (index + 1);
  return sum;
}

const FALLBACK_BRANDS = new Map<string, AirlineBrand>();

export function airlineBrand(code: string): AirlineBrand {
  const known = BRANDS[code.toUpperCase()];
  if (known) return known;

  const key = code.toUpperCase();
  const cached = FALLBACK_BRANDS.get(key);
  if (cached) return cached;

  const index = seed(key);
  const brand: AirlineBrand = {
    ...(FALLBACKS[index % FALLBACKS.length] ?? FALLBACKS[0]!),
    emblem: EMBLEMS[index % EMBLEMS.length] ?? "wing",
  };
  FALLBACK_BRANDS.set(key, brand);
  return brand;
}

/**
 * Emblem outlines in a 24×24 box, drawn as filled shapes so one badge renders with no stroke
 * math. Kept deliberately simple: at 40 px they must read instantly, not be a detailed logo.
 */
export const EMBLEM_PATHS: Record<string, string> = {
  wing: "M2.4 16.8 21.2 6.9l-6.4 10.4-4.2-2-3.3 2.9z",
  star: "M12 2.8l2.7 6 6.5.7-4.9 4.5 1.3 6.4L12 17.2 6.4 20.4l1.3-6.4L2.8 9.5l6.5-.7z",
  crescent: "M14.8 2.6a9.4 9.4 0 100 18.8 7.6 7.6 0 010-18.8z",
  tulip:
    "M12 3.4c1.7 2.1 2.6 4.1 2.6 6 1.4-1 2.3-2.5 2.7-4.4 1.5 2.3 2.2 4.5 2.2 6.5 0 3.8-3.3 6.6-7.5 6.6S4.5 15.3 4.5 11.5c0-2 .7-4.2 2.2-6.5.4 1.9 1.3 3.4 2.7 4.4 0-1.9.9-3.9 2.6-6z",
  swirl: "M12 2.6a9.4 9.4 0 108.8 12.4l-2.9-1.1A6.2 6.2 0 1112 5.8V2.6z",
  falcon: "M3.4 18.6 10.6 15 12 3.2l1.4 11.8 7.2 3.6-8.6-1.7z",
  sun: "M12 1.8l1.6 4.3 4.3-1.6-1.6 4.3 4.3 1.6-4.3 1.6 1.6 4.3-4.3-1.6L12 22.2l-1.6-5.9-4.3 1.6 1.6-4.3L1.8 12l5.9-1.6-1.6-4.3 4.3 1.6z",
  wave: "M1.8 14.2c3-3.2 5.2-3.2 8.2 0s5.2 3.2 8.2 0l4 3.4c-3.4 3.4-6.8 3.4-10.2 0s-6.8-3.4-10.2 0z",
  kite: "M12 2.4 19 9.4l-7 12.2-7-12.2z",
  crown: "M2.6 17.6 4.3 8.4l4.2 4.2L12 5.6l3.5 7 4.2-4.2 1.7 9.2z",
  swan:
    "M8.6 19.4c-2 0-3.4-1.3-3.4-3.2 0-2.4 2-3.6 4.2-4.6 2.6-1.2 4.4-2.2 4.4-4.1 0-1.5-1-2.6-2.6-2.9l.5-2.2c3.1.5 5.1 2.7 5.1 5.4 0 2.9-2.1 4.4-5 5.7-2 1-3.3 1.7-3.3 3 0 .8.6 1.3 1.5 1.3z",
};
