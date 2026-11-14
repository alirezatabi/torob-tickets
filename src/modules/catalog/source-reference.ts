import type { FlightOffer } from "@/domain/flight";

export interface SourceReference {
  href: string;
  sourceName: string;
}

/**
 * Return a reference URL only when the observed provenance identifies a trusted source.
 * Safarmarket snapshots retain an API endpoint but deliberately do not retain opaque booking
 * URLs, so this links to the provider's official site—not to a guessed per-ticket deep link.
 */
export function sourceReferenceFor(offer: {
  dataSource: FlightOffer["dataSource"];
  provenance?: Pick<NonNullable<FlightOffer["provenance"]>, "endpoint">;
}): SourceReference | null {
  if (offer.dataSource !== "crawled" || !offer.provenance?.endpoint) return null;
  try {
    const endpoint = new URL(offer.provenance.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.hostname !== "safarmarket.com") return null;
    return { href: "https://safarmarket.com/", sourceName: "Safarmarket" };
  } catch {
    return null;
  }
}
