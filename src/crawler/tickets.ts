import type { RawOffer } from "./types";

export interface CrawledTicketGroup {
  /** Stable key for UI selection and comparison. */
  key: string;
  /** Source flight code; one exact code maps to one displayed ticket. */
  code: string;
  offers: RawOffer[];
}

/** Group seller quotes by the exact captured flight code, without merging different codes. */
export function groupCrawledTickets(offers: RawOffer[]): CrawledTicketGroup[] {
  const groups = new Map<string, CrawledTicketGroup>();
  offers.forEach((offer, index) => {
    const flightCode = asText(offer.flightNumber);
    const fallback = asText(offer.flightId) ?? asText(offer.id) ?? `record-${index + 1}`;
    const code = flightCode ?? fallback;
    const key = flightCode ? `flight:${flightCode}` : `record:${fallback}`;
    const current = groups.get(key);
    if (current) current.offers.push(offer);
    else groups.set(key, { key, code, offers: [offer] });
  });
  return [...groups.values()];
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
