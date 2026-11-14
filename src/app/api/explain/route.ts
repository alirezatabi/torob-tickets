import { NextResponse } from "next/server";
import { z } from "zod";
import { searchTrips } from "@/server/search-service";
import { parseSearchParams } from "@/lib/search-params";
import { explainBestOffer } from "@/ai/explain";
import { clientKey, EXPLAIN_RATE_LIMIT, rateLimit } from "@/modules/api/rate-limit";

export const runtime = "nodejs";

const BodySchema = z.object({
  origin: z.string().length(3),
  destination: z.string().length(3),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Bounded: an offer id is a short provider key, never a payload.
  offerId: z.string().min(1).max(200).optional(),
  stops: z.coerce.number().int().min(0).max(3).optional(),
  bag: z.enum(["0", "1"]).optional(),
  price: z.enum(["low", "balanced", "comfort"]).optional(),
  time: z.enum(["early-morning", "morning", "afternoon", "evening", "night"]).optional(),
});

/**
 * Explain a recommendation.
 *
 * The offer is *re-derived* server-side from normalized data — the client cannot
 * ask us to explain an arbitrary offer with invented prices.
 */
export async function POST(request: Request) {
  const limit = rateLimit(`explain:${clientKey(request)}`, EXPLAIN_RATE_LIMIT);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید." },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds), "cache-control": "no-store" } },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "بدنهٔ درخواست باید JSON باشد." }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 422 });
  }

  const query = parseSearchParams(
    {
      origin: parsed.data.origin,
      destination: parsed.data.destination,
      date: parsed.data.date,
      stops: parsed.data.stops === undefined ? undefined : String(parsed.data.stops),
      bag: parsed.data.bag,
      price: parsed.data.price,
      time: parsed.data.time,
    },
    {},
  );

  if (!query.ok) return NextResponse.json({ error: query.reason }, { status: 422 });

  const view = await searchTrips(query.query, "best");
  // The explanation is about a *flight*: the same flight-level ranking the page shows.
  const { ranked } = view.results;
  const target =
    (parsed.data.offerId ? ranked.ranked.find((entry) => entry.input.id === parsed.data.offerId) : null) ??
    ranked.ranked[0];

  if (!target) return NextResponse.json({ error: "پیشنهادی برای توضیح یافت نشد." }, { status: 404 });

  const shown = view.results.flights.find((flight) => flight.selection.cheapest?.id === target.input.id);
  if (!shown?.selection.cheapest) {
    return NextResponse.json({ error: "پیشنهادی برای توضیح یافت نشد." }, { status: 404 });
  }
  const explanation = await explainBestOffer(shown.selection.cheapest, view.results.rankedView);

  return NextResponse.json(
    {
      offerId: target.input.id,
      text: explanation.text,
      source: explanation.source,
      ...(explanation.rejectedReason ? { rejectedReason: explanation.rejectedReason } : {}),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
