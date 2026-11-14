import { NextResponse } from "next/server";
import { DEFAULT_SORT, parseSearchParams, SORT_KEYS } from "@/lib/search-params";
import type { SortKey } from "@/ranking/score";
import { searchTrips } from "@/server/search-service";

export const runtime = "nodejs";

/**
 * Machine-readable version of a search (used by tests and by anyone inspecting the
 * aggregation output). The UI itself renders server-side and does not need this.
 *
 * The unit is a **flight**: `selection.cheapest` is the same number the card and the date
 * strip show, because all three call `selectCheapestOffer`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const parsed = parseSearchParams(raw);

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.reason, missing: parsed.missing }, { status: 422 });
  }

  const sort = (SORT_KEYS as readonly string[]).includes(raw.sort ?? "") ? (raw.sort as SortKey) : DEFAULT_SORT;
  const view = await searchTrips(parsed.query, sort);
  const { outcome, flights } = view;

  return NextResponse.json(
    {
      query: outcome.query,
      flights: flights.map((flight) => ({
        groupKey: flight.group.groupKey,
        identity: flight.group.identity,
        soldOut: flight.soldOut,
        cheapest: flight.selection.cheapest
          ? {
              offerId: flight.selection.cheapest.id,
              seller: flight.selection.cheapest.providerName,
              pricePerPersonToman: flight.selection.cheapest.price.toman,
              totalToman: flight.selection.totalToman,
              seatsAvailable: flight.selection.cheapest.seatsAvailable ?? null,
            }
          : null,
        seatsAvailable: flight.selection.seatsAvailable,
        savingsToman: flight.selection.savingsToman,
        sellers: flight.sellers.map(({ offer, deltaToman, cheapest }) => ({
          name: offer.providerName,
          priceToman: offer.price.toman,
          deltaToman,
          cheapest,
          seatsAvailable: offer.seatsAvailable ?? null,
          cabin: offer.cabin,
          purchasable: flight.ineligible.every((entry) => entry.offer.id !== offer.id),
        })),
        ineligible: flight.ineligible.map((entry) => ({ offerId: entry.offer.id, reason: entry.reason })),
        flight: {
          airline: flight.display.airlineName,
          airlineCode: flight.display.airlineCode,
          flightNumber: flight.display.flightNumber,
          departAt: flight.display.departAt,
          arriveAt: flight.display.arriveAt,
          durationMinutes: flight.display.durationMinutes,
          stops: flight.display.stops,
        },
        score: flight.score,
      })),
      health: outcome.health,
      issues: outcome.issues,
      ranking: {
        best: view.results.ranked.ranked[0]?.input.groupKey ?? null,
        weights: view.results.ranked.weights,
      },
      meta: {
        demoData: true,
        fetchedAt: outcome.fetchedAt,
        totalMs: outcome.totalMs,
        passengers: parsed.query.passengers,
        cabin: parsed.query.cabin,
        sort,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
