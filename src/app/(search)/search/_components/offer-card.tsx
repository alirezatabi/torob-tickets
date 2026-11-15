import Link from "next/link";
import { ArrowLeft, GitCompareArrows, Users } from "lucide-react";

import type { TripQuery } from "@/domain/trip";
import type { FlightResult } from "@/modules/search/results";
import { LOW_SEATS_THRESHOLD } from "@/modules/pricing/select-cheapest";
import { getCity } from "@/lib/cities";
import {
  formatDurationShort,
  formatStopsShort,
  formatTimeInZone,
  formatToman,
  isoDateInZone,
  toPersianDigits,
} from "@/lib/format";
import { flightHref } from "@/lib/search-params";
import { AirlineLogo } from "@/components/ui/airline-logo";
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import { cn } from "@/lib/cn";

/**
 * One row per physical flight — **short on purpose**.
 *
 * The list answers one question: *which flight, when, at what price*. Everything else (every
 * seller, baggage, refund terms, the route on the globe) lives on the flight's own page.
 *
 * The row is three quiet columns, and the price is a column of its own — never sharing a line
 * with the date, which is what made the previous card unreadable: the price, the total and the
 * seats used to wrap into each other. Here the order is fixed and each column has one job:
 *
 *   carrier (badge + name + aircraft) │ route (clocks, cities, duration) │ price
 *
 * The whole row is a link (a stretched, absolutely-positioned anchor), so the target is large
 * on a phone and the compare toggle stays a separate button on top of it — no nested
 * interactive elements, no dead text.
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
  /** Where "details" leads. The results list builds it; tests can pass a stub. */
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
  const passengers = query.passengers;
  const aircraft = offer.segments[0]?.aircraft ?? null;
  const arrivesNextDay =
    isoDateInZone(offer.arriveAt, destinationTz) !== isoDateInZone(offer.departAt, originTz);

  const href = detailHref ?? flightHref(query, offer.id);
  const lowSeats = seats !== null && seats <= LOW_SEATS_THRESHOLD && !soldOut;

  return (
    <article
      className={cn(
        "group relative rounded-2xl border border-ink-200/80 bg-white transition-all duration-200",
        "hover:border-teal-500/45 hover:shadow-[0_1px_2px_rgb(11_20_36_/_0.05),0_18px_34px_-26px_rgb(11_20_36_/_0.4)]",
        (muted || soldOut) && "bg-ink-50/50 opacity-80 hover:opacity-100",
        selected && "border-teal-600/60 ring-1 ring-teal-500/25",
      )}
      style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
      data-testid="offer-card"
      data-group-key={group.groupKey}
      data-sold-out={soldOut ? "true" : undefined}
    >
      {/* One click target for the whole row; the visible affordance is the chevron. */}
      <Link
        href={href}
        className="absolute inset-0 z-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
        data-testid="flight-details"
        aria-label={`جزئیات پرواز ${offer.airlineName} ساعت ${departTime} از ${origin?.fa ?? offer.originCode} به ${destination?.fa ?? offer.destinationCode}`}
      />

      <div className="pointer-events-none relative z-10 flex flex-col gap-2.5 p-3 sm:grid sm:grid-cols-[minmax(0,11.5rem)_minmax(0,1fr)_auto] sm:items-center sm:gap-3 sm:p-3.5">
        {/* ——— carrier ——— */}
        <div className="flex min-w-0 items-center gap-2.5">
          <AirlineLogo code={offer.airlineCode} name={offer.airlineName} size={36} />
          <div className="min-w-0">
            <p className="truncate text-[0.8rem] font-bold leading-5 text-ink-900">{offer.airlineName}</p>
            <p className="truncate text-[0.62rem] leading-4 text-ink-400" data-testid="flight-aircraft">
              {aircraft ?? "نوع هواپیما نامشخص"}
              {offer.flightNumber ? ` · ${offer.flightNumber}` : ""}
            </p>
            <div className="mt-1"><DataSourceBadge source={offer.dataSource} variant="inline" /></div>
          </div>
        </div>

        {/* ——— route: two clocks, one line between them ——— */}
        <div className="flex min-w-0 items-center gap-2 sm:justify-center sm:gap-3">
          <span className="nums shrink-0 text-[0.98rem] font-extrabold leading-6 text-ink-900">{departTime}</span>

          <span className="flex min-w-0 flex-1 flex-col items-center gap-0.5 sm:max-w-[9rem]">
            <span className="text-[0.56rem] leading-3 text-ink-400">{formatStopsShort(offer.stops)}</span>
            <span className="flex w-full items-center" aria-hidden="true">
              <span className="size-1.5 shrink-0 rounded-full bg-ink-300" />
              <span className="h-px flex-1 border-t border-dashed border-ink-300" />
              <span className="nums px-1 text-[0.56rem] leading-3 text-ink-400">
                {formatDurationShort(offer.durationMinutes)}
              </span>
              <span className="h-px flex-1 border-t border-dashed border-ink-300" />
              <span className="size-1.5 shrink-0 rounded-full bg-teal-500" />
            </span>
            <span className="max-w-full truncate text-[0.58rem] leading-3 text-ink-400">
              {origin?.fa ?? offer.originCode} ← {destination?.fa ?? offer.destinationCode}
            </span>
          </span>

          <span className="nums shrink-0 text-[0.98rem] font-extrabold leading-6 text-ink-900">
            {arriveTime}
            {arrivesNextDay && (
              <span className="mr-0.5 align-super text-[0.5rem] font-bold text-saffron-600">+۱</span>
            )}
          </span>
        </div>

        {/* ——— price: its own column, right-aligned, never wrapping into the route ——— */}
        <div className="flex items-end justify-between gap-2 border-t border-ink-100 pt-2 sm:items-center sm:border-t-0 sm:pt-0">
          <div className="flex flex-col items-start gap-0.5 sm:items-end">
            <p
              className={cn(
                "nums whitespace-nowrap text-[0.98rem] font-black leading-6 tracking-tight",
                soldOut ? "text-[0.74rem] font-bold text-ink-500" : "text-ink-900",
              )}
              data-testid="offer-price"
            >
              {soldOut ? "تکمیل ظرفیت" : formatToman(offer.price.toman)}
            </p>
            <p className="nums whitespace-nowrap text-[0.56rem] leading-3 text-ink-400" data-testid="offer-total">
              {soldOut
                ? "برای این تعداد مسافر"
                : passengers > 1 && selection.totalToman !== null
                  ? `مجموع ${toPersianDigits(passengers)} نفر: ${formatToman(selection.totalToman)}`
                  : "برای هر نفر"}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            {seats !== null && (
              <span
                className={cn(
                  "nums inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[0.58rem] font-medium",
                  soldOut
                    ? "bg-ink-100 text-ink-500"
                    : lowSeats
                      ? "bg-saffron-50 text-saffron-700"
                      : "bg-teal-50 text-teal-700",
                )}
                data-testid="flight-capacity"
                title="ظرفیت این پرواز: بیشترین صندلیِ اعلام‌شده میان فروشندگانی که می‌توانند همین تعداد مسافر را بفروشند."
              >
                <Users className="size-2.5" aria-hidden="true" />
                {soldOut ? "بدون صندلی" : `${toPersianDigits(seats)} صندلی`}
              </span>
            )}

            {onToggleCompare && (
              <button
                type="button"
                onClick={onToggleCompare}
                disabled={compareDisabled}
                aria-pressed={selected}
                aria-label={selected ? "حذف از مقایسه" : "افزودن به مقایسه"}
                title={selected ? "حذف از مقایسه" : "افزودن به مقایسه"}
                className={cn(
                  "pointer-events-auto grid size-6 place-items-center rounded-md border transition-colors",
                  selected
                    ? "border-teal-600 bg-teal-50 text-teal-700"
                    : "border-ink-200 text-ink-400 hover:border-ink-300 hover:text-ink-700",
                  compareDisabled && "cursor-not-allowed opacity-40",
                )}
              >
                <GitCompareArrows className="size-3" aria-hidden="true" />
              </button>
            )}

            <ArrowLeft
              className="hidden size-3.5 shrink-0 text-ink-300 transition-transform group-hover:-translate-x-0.5 group-hover:text-teal-600 sm:block"
              aria-hidden="true"
            />
          </div>
        </div>
      </div>
    </article>
  );
}
