import { NextResponse } from "next/server";
import { parseSearchParams } from "@/lib/search-params";
import { runSearch } from "@/providers/search";
import type { SortKey } from "@/ranking/score";
import { prepareResultList } from "@/providers/search";
import { DEFAULT_SORT, SORT_KEYS } from "@/lib/search-params";

export const runtime = "nodejs";

/**
 * Machine-readable version of a search (used by tests and by anyone inspecting the
 * aggregation output). The UI itself renders server-side and does not need this.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const parsed = parseSearchParams(raw);

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.reason, missing: parsed.missing }, { status: 422 });
  }

  const sort = (SORT_KEYS as readonly string[]).includes(raw.sort ?? "") ? (raw.sort as SortKey) : DEFAULT_SORT;
  const outcome = await runSearch(parsed.query);
  const { groups } = prepareResultList(outcome, sort);

  return NextResponse.json(
    {
      query: outcome.query,
      groups: groups.map((group) => ({
        groupKey: group.groupKey,
        cheapestToman: group.cheapestToman,
        providers: group.providers.map((provider) => ({
          name: provider.providerName,
          priceToman: provider.priceToman,
          original: provider.original,
        })),
        flight: {
          airline: group.primary.airlineName,
          flightNumber: group.primary.flightNumber,
          departAt: group.primary.departAt,
          arriveAt: group.primary.arriveAt,
          durationMinutes: group.primary.durationMinutes,
          stops: group.primary.stops,
          baggage: group.primary.baggage,
          refundable: group.primary.refundable,
        },
      })),
      health: outcome.health,
      issues: outcome.issues,
      ranking: {
        best: outcome.ranked.best?.offer.id ?? null,
        cheapest: outcome.ranked.cheapest?.offer.id ?? null,
        fastest: outcome.ranked.fastest?.offer.id ?? null,
        weights: outcome.ranked.weights,
      },
      meta: { demoData: true, fetchedAt: outcome.fetchedAt, totalMs: outcome.totalMs },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
