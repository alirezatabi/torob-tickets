import type { RawOffer } from "./types";

export interface NormalizedRawOffer extends RawOffer {
  warnings: string[];
}
const iso = (value: string | null): boolean => value !== null && Number.isFinite(Date.parse(value));

/** Conservative validation only: no currency conversion, timezone, airport or missing-field guesses. */
export function normalizeRawOffers(rows: RawOffer[]): NormalizedRawOffer[] {
  return rows.map((row) => {
    const warnings: string[] = [];
    if (row.amount !== null && (!Number.isFinite(row.amount) || row.amount <= 0)) warnings.push("invalid-price");
    if (row.amount !== null && row.currency === null) warnings.push("currency-missing");
    if (row.departAt !== null && !iso(row.departAt)) warnings.push("invalid-departure-time");
    if (row.arriveAt !== null && !iso(row.arriveAt)) warnings.push("invalid-arrival-time");
    if (row.departAt === null && typeof row.departureLocal === "string") warnings.push("timezone-unresolved");
    if (row.arriveAt === null && typeof row.arrivalLocal === "string") warnings.push("timezone-unresolved");
    for (const key of ["id", "origin", "destination", "departAt", "arriveAt", "airline", "flightNumber", "amount", "currency", "seats", "offerUrl"] as const) {
      if (row[key] === undefined) row[key] = null;
    }
    return { ...row, warnings };
  });
}
