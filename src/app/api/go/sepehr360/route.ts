import { NextResponse, type NextRequest } from "next/server";

import { buildSearchUrl, SEPEHR360_BASE } from "@/modules/providers/sepehr360/url";
import { getCity } from "@/lib/cities";

/**
 * `GET /api/go/sepehr360` — the redirect to the source.
 *
 * Why a server hop instead of rendering the source URL straight into the card's anchor:
 *
 *   • **One place builds the URL.** The destination has to be a *Jalali-dated search page*
 *     with the right airports; building that in a client component would duplicate a
 *     conversion that is already unit-tested in `sepehr360/url.ts`.
 *   • **Only known-good targets.** The route accepts city codes and a date, then rebuilds
 *     the URL itself — a query parameter can never smuggle in an arbitrary host.
 *   • **Auditable.** One log line per click says which provider, route and date the user
 *     was sent to.
 *
 * It deliberately does **not** claim a per-fare deep link: Sepehr360 publishes no URL for an
 * individual offer, so the landing page is the search for that route/date, with the
 * departure time and airline carried in the query string as context only.
 */

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]?\d|2[0-3]):[0-5]\d$/;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const origin = (params.get("origin") ?? "").toUpperCase();
  const destination = (params.get("destination") ?? "").toUpperCase();
  const date = params.get("date") ?? "";

  if (!getCity(origin) || !getCity(destination) || !ISO_DATE.test(date)) {
    // A malformed link must not bounce the user to an unrelated page silently.
    return NextResponse.redirect(new URL("/live", request.nextUrl.origin), { status: 302 });
  }

  const target = buildSearchUrl(
    { originCity: origin, destinationCity: destination, departDate: date },
    {
      departTime: CLOCK.test(params.get("time") ?? "") ? params.get("time") : null,
      airlineCode: params.get("airline"),
    },
  );

  // The allowlisted base comes from the connector, never from the request.
  if (!target.url.startsWith(SEPEHR360_BASE)) {
    return NextResponse.redirect(new URL("/live", request.nextUrl.origin), { status: 302 });
  }

  console.info(
    `[redirect] provider=sepehr360 route=${origin}>${destination} date=${date} ` +
      `time=${params.get("time") ?? "-"} airline=${params.get("airline") ?? "-"}`,
  );

  return NextResponse.redirect(target.url, {
    status: 302,
    // The destination is a live third-party page: never let a proxy cache the hop.
    headers: { "cache-control": "no-store" },
  });
}
