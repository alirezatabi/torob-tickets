import { NextResponse } from "next/server";

import {
  getPriceHistory,
  HISTORY_RANGE_LABELS_FA,
  type HistoryRange,
} from "@/modules/history/price-history";
import { getCity } from "@/lib/cities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RANGES: HistoryRange[] = ["24h", "7d", "30d", "90d", "all"];

/**
 * GET /api/live/history?offerKey=… (or ?groupKey=…, or ?origin=THR&destination=MHD&date=…)
 *                     [&range=24h|7d|30d|90d|all]
 *
 * One series per fare-level offer identity. Different fare conditions never share a
 * line, and there is no synthetic data point — sparse history is returned as sparse.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const range = RANGES.includes(params.range as HistoryRange) ? (params.range as HistoryRange) : "30d";

  // Validate the route pair instead of trusting it: a typo must produce a clear 400,
  // not a silently empty chart.
  const originCity = params.origin?.toUpperCase();
  const destinationCity = params.destination?.toUpperCase();
  if ((originCity && !getCity(originCity)) || (destinationCity && !getCity(destinationCity))) {
    return NextResponse.json(
      { available: false, reasonFa: "کد شهر نامعتبر است", range, series: [], pointCount: 0 },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const result = await getPriceHistory({
    offerKey: params.offerKey,
    groupKey: params.groupKey,
    originCity,
    destinationCity,
    departDate: params.date,
    range,
  });

  return NextResponse.json(
    {
      ...result,
      rangeLabelFa: HISTORY_RANGE_LABELS_FA[result.range],
      availableRanges: RANGES.map((value) => ({ value, labelFa: HISTORY_RANGE_LABELS_FA[value] })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
