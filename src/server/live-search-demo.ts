/**
 * Demo offers for the live-shaped search response.
 *
 * The demo dataset is *generated* from curated schedules and a documented fare engine
 * — it is not scraped and never claims to be. Here it is only reshaped so the *same*
 * response contract and the *same* ranking core serve both modes. Every offer keeps
 * `dataSource: "demo"`, which the UI prints out loud.
 */

import type { FlightOffer } from "@/domain/flight";
import type { TripQuery } from "@/domain/trip";
import { FLIGHT_PROVIDERS } from "@/providers/registry";

export async function getDemoOffers(query: TripQuery): Promise<FlightOffer[]> {
  const offers: FlightOffer[] = [];

  for (const adapter of FLIGHT_PROVIDERS) {
    try {
      // Demo adapters are in-process generators: no network, no randomness across runs.
      const raw = await adapter.search(query);
      offers.push(...adapter.normalize(raw as never, query).offers);
    } catch {
      // A demo generator cannot fail in practice; if one does, skip it — the demo path
      // must never break the page.
    }
  }

  return offers;
}
