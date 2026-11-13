import Link from "next/link";
import { ArrowLeft, GitCompareArrows, Plane, Timer, Users } from "lucide-react";

import type { TripQuery } from "@/domain/trip";
import type { FlightResult } from "@/modules/search/results";
import { LOW_SEATS_THRESHOLD } from "@/modules/pricing/select-cheapest";
import { getCity } from "@/lib/cities";
import { formatDurationShort, formatStopsShort, formatTimeInZone, formatToman, isoDateInZone, toPersianDigits } from "@/lib/format";
import { flightHref } from "@/lib/search-params";
import { cn } from "@/lib/cn";

/**
 * One row per physical flight — **short on purpose**.
 *
 * The results page answers one question: *which flight, when, at what price*. Everything
 * else (every seller, baggage, refund terms, aircraft age, the per-fare detail) belongs on
 * that flight's own page, linked from here. A card that repeats all of it makes the list
 * unscannable and buries the comparison the product exists for.
 *
 * So this card shows exactly: departure/arrival clock, origin → destination, the airline
 * and the aircraft, the cheapest price, and how many seats are left — and one link to the
 * detail page. Nothing numeric is computed here: every value comes from `FlightResult`
 * (built by `selectCheapestOffer`), so the row can never disagree with the strip, the
 * detail page or the API.
 */
export function OfferCard({
  flight,
  query,
  index,
  muted = false,
  selected = false,
  onToggleCompare,
  compareDisabled = false,
  detailHref,
}: {
  flight: FlightResult;
  query: TripQuery;
  index: number;
  muted?: boolean;
  selected?: boolean;
  onToggleCompare?: () => void;
  compareDisabled?: boolean;
  /** Where "details" leads. The results list builds it; the tests can pass a stub. */
  detailHref?: string;
}) {
  const { group, selection } = flight;
  const offer = selection.cheapest ?? flight.display;
  const origin = getCity(offer.originCode);
  const destination = getCity(offer.destinationCode);
  const originTz = origin?.timezone ?? "Asia/Tehran";
  const destinationTz = destination?.timezone ?? "Asia/Tehran";
  const departTime = formatTimeInZone(offer.departAt, originTz);
  const arriveTime = formatTimeInZone(offer.arriveAt, destinationTz);
  const seats = selection.seatsAvailable;
  const soldOut = flight.soldOut;
  const perPerson = selection.cheapest?.price.toman ?? null;
  const passengers = query.passengers;
  const aircraft = offer.segments[0]?.aircraft ?? null;
  const arrivesNextDay = isoDateInZone(offer.arriveAt, destinationTz) !== isoDateInZone(offer.departAt, originTz);

  const href = detailHref ?? flightHref(query, offer.id);

  return (
    <article
      className={cn(
        "card card-hover group relative overflow-hidden",
        (muted || soldOut) && "opacity-70 hover:opacity-100",
      )}
      style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
      data-testid="offer-card"
      data-group-key={group.groupKey}
      data-sold-out={soldOut ? "true" : undefined}
    >
      <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-4">
        {/* ——— airline + aircraft ——— */}
        <div className="flex min-w-0 items-center gap-2.5 sm:w-52">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink-900 text-[0.62rem] font-bold text-white">
            {offer.airlineCode}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[0.8rem] font-bold text-ink-900">{offer.airlineName}</p>
            <p className="truncate text-[0.62rem] text-ink-400" data-testid="flight-aircraft">
              {aircraft ?? "نوع هواپیما نامشخص"}
              {offer.flightNumber ? ` · ${offer.flightNumber}` : ""}
            </p>
          </div>
        </div>

        {/* ——— clock + route ——— */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="text-center">
            <p className="nums text-[0.95rem] font-extrabold text-ink-900">{departTime}</p>
            <p className="mt-0.5 truncate text-[0.6rem] text-ink-400">{origin?.fa ?? offer.originCode}</p>
          </div>

          <div className="min-w-0 flex-1 px-1">
            <div className="flex items-center gap-1.5">
              <span className="size-1 rounded-full bg-ink-300" aria-hidden="true" />
              <span className="h-px flex-1 border-t border-dashed border-ink-300" aria-hidden="true" />
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ink-50 px-1.5 py-0.5 text-[0.58rem] text-ink-500">
                <Plane className="size-2.5" aria-hidden="true" />
                {formatStopsShort(offer.stops)}
              </span>
              <span className="h-px flex-1 border-t border-dashed border-ink-300" aria-hidden="true" />
              <span className="size-1 rounded-full bg-teal-500" aria-hidden="true" />
            </div>
            <p className="mt-0.5 inline-flex w-full items-center justify-center gap-1 text-[0.58rem] text-ink-400">
              <Timer className="size-2.5" aria-hidden="true" />
              {formatDurationShort(offer.durationMinutes)}
            </p>
          </div>

          <div className="text-center">
            <p className="nums text-[0.95rem] font-extrabold text-ink-900">
              {arriveTime}
              {arrivesNextDay && <span className="mr-0.5 align-super text-[0.55rem] text-saffron-600">+۱</span>}
            </p>
            <p className="mt-0.5 truncate text-[0.6rem] text-ink-400">{destination?.fa ?? offer.destinationCode}</p>
          </div>
        </div>

        {/* ——— seats + price + link ——— */}
        <div className="flex items-center justify-between gap-3 border-t border-ink-100 pt-3 sm:w-[16rem] sm:justify-end sm:border-r sm:border-t-0 sm:pl-4 sm:pt-0">
          <div className="text-right">
            {soldOut ? (
              <p className="text-[0.72rem] font-bold text-ink-500" data-testid="offer-price">
                تکمیل ظرفیت
              </p>
            ) : (
              <>
                <p className="nums text-[1.05rem] font-black tracking-tight text-ink-900" data-testid="offer-price">
                  {formatToman(perPerson ?? 0)}
                </p>
                {passengers > 1 && selection.totalToman !== null && (
                  <p className="mt-0.5 text-[0.58rem] text-ink-500" data-testid="offer-total">
                    مجموع {formatToman(selection.totalToman)}
                  </p>
                )}
              </>
            )}
            {seats !== null && (
              <span
                className={cn(
                  "mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.6rem] font-medium",
                  soldOut
                    ? "bg-ink-100 text-ink-500"
                    : seats <= LOW_SEATS_THRESHOLD
                      ? "bg-saffron-100 text-saffron-700"
                      : "bg-teal-50 text-teal-700",
                )}
                data-testid="flight-capacity"
                title="ظرفیت این پرواز: بیشترین صندلیِ اعلام‌شده میان فروشندگانی که می‌توانند همین تعداد مسافر را بفروشند."
              >
                <Users className="size-3" aria-hidden="true" />
                {soldOut ? "بدون صندلی" : `${toPersianDigits(seats)} صندلی`}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {onToggleCompare && (
              <button
                type="button"
                onClick={onToggleCompare}
                disabled={compareDisabled}
                aria-pressed={selected}
                aria-label={selected ? "حذف از مقایسه" : "افزودن به مقایسه"}
                title={selected ? "حذف از مقایسه" : "افزودن به مقایسه"}
                className={cn(
                  "grid size-7 place-items-center rounded-lg border transition-colors",
                  selected
                    ? "border-teal-600 bg-teal-50 text-teal-700"
                    : "border-ink-200 text-ink-400 hover:border-ink-300 hover:text-ink-700",
                  compareDisabled && "cursor-not-allowed opacity-40",
                )}
              >
                <GitCompareArrows className="size-3.5" aria-hidden="true" />
              </button>
            )}

          <Link
            href={href}
            className="btn-primary shrink-0 py-1.5 text-[0.7rem]"
            data-testid="flight-details"
            aria-label={`جزئیات پرواز ${offer.airlineName} ${departTime}`}
          >
            جزئیات
            <ArrowLeft className="size-3" aria-hidden="true" />
          </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
