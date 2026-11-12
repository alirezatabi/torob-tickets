import { NextResponse } from "next/server";
import { z } from "zod";
import { searchTrips } from "@/server/search-service";
import { parseSearchParams } from "@/lib/search-params";
import { addDays, isoToday } from "@/lib/jalali";
import { explainBestOffer } from "@/ai/explain";

export const runtime = "nodejs";

const BodySchema = z.object({
  origin: z.string().length(3),
  destination: z.string().length(3),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  offerId: z.string().min(1).optional(),
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
    { date: addDays(isoToday(), 7) },
  );

  if (!query.ok) return NextResponse.json({ error: query.reason }, { status: 422 });

  const view = await searchTrips(query.query, "best");
  const { ranked } = view.outcome;
  const target =
    (parsed.data.offerId ? ranked.ranked.find((scored) => scored.offer.id === parsed.data.offerId) : null) ??
    ranked.best;

  if (!target) return NextResponse.json({ error: "پیشنهادی برای توضیح یافت نشد." }, { status: 404 });

  const explanation = await explainBestOffer(target.offer, ranked);

  return NextResponse.json(
    {
      offerId: target.offer.id,
      text: explanation.text,
      source: explanation.source,
      ...(explanation.rejectedReason ? { rejectedReason: explanation.rejectedReason } : {}),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
