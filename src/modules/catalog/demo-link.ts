/**
 * Where a card's action link may point, in a build with **only demo data**.
 *
 * The rule is simple and absolute: a demo offer is generated in-process and has no page at
 * any source, so it never renders a "go to the seller" link. Instead the card offers the
 * one honest action that exists — run the same route/date as a real search in this app.
 */

import { getCity } from "@/lib/cities";
import { localDepartDate } from "@/lib/time";

/** The in-app search page for an offer, so "go and compare it yourself" still works. */
export function demoSearchHref(offer: { originCity: string; destinationCity: string; departAt: string }): string {
  const originTimeZone = getCity(offer.originCity)?.timezone ?? "Asia/Tehran";
  const params = new URLSearchParams({
    origin: offer.originCity,
    destination: offer.destinationCity,
    date: localDepartDate(offer.departAt, originTimeZone),
  });
  return `/search?${params.toString()}`;
}

/**
 * Why this offer has no external link. A constant, because the reason is now the same for
 * every offer in the product — sample data is not for sale anywhere.
 */
export const NO_SOURCE_REASON_FA =
  "این نرخ ساختهٔ دادهٔ نمونه است؛ صفحه‌ای در هیچ منبعی ندارد و در این نسخه خریدی انجام نمی‌شود.";
