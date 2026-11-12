import Link from "next/link";
import { ArrowUpLeft, Briefcase, CircleSlash, GitCompareArrows, Plane, RotateCcw, Timer, TriangleAlert, Users } from "lucide-react";
import { WARNING_LABELS } from "@/domain/flight";
import type { TripQuery } from "@/domain/trip";
import type { FlightResult } from "@/modules/search/results";
import { LOW_SEATS_THRESHOLD, isPurchasable } from "@/modules/pricing/select-cheapest";
import { getCity } from "@/lib/cities";
import {
  formatDurationShort,
  formatRelative,
  formatStopsShort,
  formatTimeInZone,
  formatToman,
  isoDateInZone,
  toPersianDigits,
} from "@/lib/format";
import { cn } from "@/lib/cn";
import { sourceLinkFor } from "@/modules/live/source-link";

/**
 * One physical flight: the airline, the clock, the aircraft — and underneath it, **every
 * seller's price for that same flight**, cheapest first and highlighted.
 *
 * Everything numeric on this card comes from `FlightResult` (built by `selectCheapestOffer`),
 * so the card can never disagree with the date strip, the suggestion or the API.
 */
export function OfferCard({
  flight,
  query,
  index,
  selected,
  onToggleCompare,
  compareDisabled,
  muted = false,
}: {
  flight: FlightResult;
  query: TripQuery;
  index: number;
  selected: boolean;
  onToggleCompare: () => void;
  compareDisabled?: boolean;
  muted?: boolean;
}) {
  const { group, selection } = flight;
  const offer = selection.cheapest ?? flight.display;
  const source = sourceLinkFor(offer);
  const origin = getCity(offer.originCode);
  const destination = getCity(offer.destinationCode);
  const originTz = origin?.timezone ?? "Asia/Tehran";
  const destinationTz = destination?.timezone ?? "Asia/Tehran";
  const departTime = formatTimeInZone(offer.departAt, originTz);
  const arriveTime = formatTimeInZone(offer.arriveAt, destinationTz);
  const passengers = query.passengers;
  const seats = selection.seatsAvailable;
  const soldOut = flight.soldOut;
  const perPerson = selection.cheapest?.price.toman ?? null;
  const total = selection.totalToman;

  // Two different facts, never conflated: how many *sources* we queried, and how many
  // *agencies* the source itself says carry this fare.
  const sellerBadge =
    group.knownSellers > group.providers.length ? (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[0.62rem] font-semibold text-teal-700"
        title="تعداد آژانس‌هایی که همین پرواز را می‌فروشند، به گفتهٔ منبع؛ فهرست تک‌تک آن‌ها منتشر نشده است."
      >
        {toPersianDigits(group.knownSellers)} فروشنده
      </span>
    ) : group.providers.length > 1 ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-saffron-50 px-2 py-0.5 text-[0.62rem] font-semibold text-saffron-600">
        {toPersianDigits(group.providers.length)} منبع
      </span>
    ) : null;

  const arrivesNextDay =
    isoDateInZone(offer.arriveAt, destinationTz) !== isoDateInZone(offer.departAt, originTz);

  return (
    <article
      className={cn(
        "card card-hover group relative overflow-hidden",
        selected && "border-teal-500/70 ring-2 ring-teal-500/40",
        (muted || soldOut) && "opacity-75 hover:opacity-95",
      )}
      style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
      data-testid="offer-card"
      data-group-key={group.groupKey}
      data-sold-out={soldOut ? "true" : undefined}
    >
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 right-0 w-1 transition-colors",
          selected ? "bg-teal-500" : soldOut ? "bg-ink-200" : "bg-transparent group-hover:bg-teal-500/40",
        )}
      />
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-stretch">
        {/* ——— Airline + timeline ——— */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink-900 text-[0.62rem] font-bold text-white shadow-sm">
              {offer.airlineCode}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[0.8rem] font-bold text-ink-900">{offer.airlineName}</p>
              <p className="text-[0.65rem] text-ink-400">
                {offer.flightNumber ? `پرواز ${offer.flightNumber}` : "شماره پرواز اعلام نشده"}
                {offer.segments[0]?.aircraft ? ` · ${offer.segments[0].aircraft}` : ""}
              </p>
            </div>
            <span className="mr-auto flex flex-wrap items-center justify-end gap-1.5">
              {group.identity === "same-departure" ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[0.6rem] font-medium text-ink-500"
                  title="هیچ منبعی شمارهٔ پرواز را اعلام نکرده؛ یکسان بودن ساعت حرکت مبنای گروه‌بندی است."
                >
                  <TriangleAlert className="size-2.5" aria-hidden="true" />
                  شناسایی بر پایهٔ ساعت حرکت
                </span>
              ) : null}
              {sellerBadge}
            </span>
          </div>

          <div className="mt-3 flex items-center gap-2 sm:gap-3">
            <div className="text-center">
              <p className="text-[0.95rem] font-extrabold text-ink-900 nums">{departTime}</p>
              <p className="mt-0.5 text-[0.62rem] text-ink-400" dir="ltr">
                {offer.originCode}
              </p>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="size-1.5 shrink-0 rounded-full bg-ink-300" aria-hidden="true" />
                <span className="h-px flex-1 border-t border-dashed border-ink-300" aria-hidden="true" />
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ink-50 px-1.5 py-0.5 text-[0.6rem] text-ink-500">
                  <Plane className="size-2.5" aria-hidden="true" />
                  {formatStopsShort(offer.stops)}
                </span>
                <span className="h-px flex-1 border-t border-dashed border-ink-300" aria-hidden="true" />
                <span className="size-1.5 shrink-0 rounded-full bg-teal-500" aria-hidden="true" />
              </div>
              <p className="mt-1 text-center text-[0.62rem] text-ink-400">
                {formatDurationShort(offer.durationMinutes)} ساعت
                {offer.stops > 0 && offer.segments[1] ? (
                  <span className="hidden sm:inline">
                    {" "}
                    · توقف در {getCity(offer.segments[0]?.destinationCode ?? "")?.fa ?? "—"}
                  </span>
                ) : null}
              </p>
            </div>

            <div className="text-center">
              <p className="text-[0.95rem] font-extrabold text-ink-900 nums">
                {arriveTime}
                {arrivesNextDay && <span className="mr-0.5 align-super text-[0.55rem] text-saffron-600">+۱</span>}
              </p>
              <p className="mt-0.5 text-[0.62rem] text-ink-400" dir="ltr">
                {offer.destinationCode}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Feature icon={<Briefcase className="size-3" aria-hidden="true" />}>
              {offer.baggage.checked === "included"
                ? offer.baggage.checkedKg !== null
                  ? `بار ${toPersianDigits(offer.baggage.checkedKg)} کیلو`
                  : "با بار"
                : offer.baggage.checked === "not-included"
                  ? "بدون بار"
                  : "بار نامشخص"}
            </Feature>
            <Feature icon={<RotateCcw className="size-3" aria-hidden="true" />}>
              {offer.refundable === true ? "قابل استرداد" : offer.refundable === false ? "غیرقابل استرداد" : "استرداد نامشخص"}
            </Feature>
            <Feature icon={<Timer className="size-3" aria-hidden="true" />}>{formatRelative(offer.providerUpdatedAt)}</Feature>
            {seats !== null && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.62rem] font-medium",
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
                {soldOut ? "ظرفیت تکمیل" : `${toPersianDigits(seats)} صندلی`}
                {!soldOut && seats <= LOW_SEATS_THRESHOLD && <span className="font-bold">· کم</span>}
              </span>
            )}
            {offer.warnings.includes("price-converted") && (
              <span className="chip border-saffron-300/60 bg-saffron-50 text-[0.6rem] text-saffron-600" title={WARNING_LABELS["price-converted"]}>
                {offer.price.original.currency} → تومان
              </span>
            )}
          </div>

          {flight.violations.length > 0 && (
            <p className="mt-2 rounded-lg bg-ink-100 px-2 py-1 text-[0.62rem] leading-5 text-ink-500">
              خارج از ترجیحات: {flight.violations.join("، ")}
            </p>
          )}
        </div>

        {/* ——— Price + sellers + actions ——— */}
        <div className="flex shrink-0 flex-row items-end justify-between gap-3 border-t border-ink-100 pt-3 sm:w-[14.5rem] sm:flex-col sm:items-stretch sm:border-r sm:border-t-0 sm:pr-4 sm:pt-0">
          <div className="text-left sm:text-right">
            {soldOut ? (
              <>
                <p className="inline-flex items-center gap-1 text-[0.7rem] font-bold text-ink-500" data-testid="offer-price">
                  <CircleSlash className="size-3.5" aria-hidden="true" />
                  تکمیل ظرفیت
                </p>
                <p className="mt-1 text-[0.6rem] leading-5 text-ink-400">
                  هیچ فروشنده‌ای {toPersianDigits(passengers)} صندلی برای این پرواز ندارد.
                </p>
              </>
            ) : (
              <>
                <p className="text-[0.6rem] text-ink-400">
                  {group.providers.length > 1 ? `ارزان‌ترین · ${toPersianDigits(group.providers.length)} منبع` : "ارزان‌ترین نرخ"}
                </p>
                <p className="text-[1.15rem] font-black tracking-tight text-ink-900 nums" data-testid="offer-price">
                  {formatToman(perPerson ?? 0)}
                </p>
                {passengers > 1 && total !== null && (
                  <p className="mt-0.5 text-[0.6rem] text-ink-500" data-testid="offer-total">
                    هر نفر {formatToman(perPerson ?? 0)} · مجموع {formatToman(total)} برای {toPersianDigits(passengers)} مسافر
                  </p>
                )}
                {selection.cheapestWithBaggage && selection.cheapest && (
                  <p className="mt-1 text-[0.6rem] text-teal-700">
                    با بار همراه: {formatToman(selection.cheapestWithBaggage.price.toman)} از {selection.cheapestWithBaggage.providerName}
                  </p>
                )}
                {selection.savingsToman > 0 && (
                  <p className="mt-1 text-[0.6rem] font-medium text-saffron-600">
                    صرفه‌جویی تا {formatToman(selection.savingsToman)}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Link
              href={`/compare?${new URLSearchParams({ groups: `${group.groupKey}:${offer.id}` }).toString()}`}
              className="text-center text-[0.6rem] text-ink-400 hover:text-teal-700 hover:underline"
            >
              {group.providers.length > 1 ? `مقایسهٔ ${toPersianDigits(group.providers.length)} نرخ` : "جزئیات نرخ"}
            </Link>

            {soldOut ? (
              <span className="btn-ghost w-full cursor-default py-2 text-[0.72rem]" title="برای این تعداد مسافر صندلی کافی نیست.">
                فروشنده‌ای نیست
              </span>
            ) : source.kind === "external" ? (
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="btn-primary w-full py-2 text-[0.72rem]"
                title="صفحهٔ جست‌وجوی منبع، نه لینک اختصاصی این نرخ"
              >
                مشاهده در {offer.providerName}
                <ArrowUpLeft className="size-3.5" aria-hidden="true" />
              </a>
            ) : (
              <span className="btn-ghost w-full cursor-default py-2 text-[0.72rem]" title={source.reason}>
                دادهٔ نمونه · {offer.providerName}
              </span>
            )}

            <button
              type="button"
              onClick={onToggleCompare}
              disabled={compareDisabled}
              aria-pressed={selected}
              className={cn(
                "btn-ghost w-full py-1.5 text-[0.7rem]",
                selected && "border-teal-500 bg-teal-50 text-teal-700",
                compareDisabled && "cursor-not-allowed opacity-50",
              )}
            >
              <GitCompareArrows className="size-3.5" aria-hidden="true" />
              {selected ? "انتخاب‌شده برای مقایسه" : "افزودن به مقایسه"}
            </button>
          </div>
        </div>
      </div>

      {flight.sellers.length > 0 && (
        <div className="border-t border-ink-100 bg-ink-50/60 px-4 py-2">
          <p className="mb-1 text-[0.6rem] text-ink-400">
            همین پرواز، در هر منبعی که نرخش را دارد
            {passengers > 1 ? ` · قیمت هر نفر، برای ${toPersianDigits(passengers)} مسافر` : ""}:
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1" data-testid="seller-list">
            {flight.sellers.map(({ offer: seller, deltaToman, cheapest }) => {
              const purchasable = isPurchasable(seller, passengers);
              const cabinMismatch = seller.cabin !== query.cabin;
              return (
                <li
                  key={seller.id}
                  className={cn(
                    "inline-flex items-center gap-1.5 text-[0.65rem]",
                    purchasable && !cabinMismatch ? "text-ink-600" : "text-ink-400 line-through decoration-ink-300",
                  )}
                  title={
                    !purchasable
                      ? `ظرفیت کافی نیست (${toPersianDigits(seller.seatsAvailable ?? 0)} صندلی)`
                      : cabinMismatch
                        ? "کلاس کابین متفاوت است"
                        : undefined
                  }
                >
                  <span className="font-medium">{seller.providerName}</span>
                  <span className="nums text-ink-800">{formatToman(seller.price.toman)}</span>
                  {cheapest && (
                    <span className="rounded bg-teal-100 px-1 text-[0.55rem] font-semibold text-teal-800">کمترین</span>
                  )}
                  {!cheapest && purchasable && deltaToman > 0 && (
                    <span className="text-[0.58rem] text-ink-400">+{formatToman(deltaToman)}</span>
                  )}
                  {!purchasable && <span className="no-underline text-[0.58rem] text-saffron-600">ظرفیت کافی نیست</span>}
                  {!purchasable ? null : seller.baggage.checked === "included" ? (
                    <span className="text-[0.58rem] text-teal-700">{seller.baggage.checkedKg ?? "با"} کیلو بار</span>
                  ) : (
                    <span className="text-[0.58rem] text-ink-400">بدون/نامشخص بار</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </article>
  );
}

function Feature({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-1.5 py-0.5 text-[0.62rem] text-ink-600">
      {icon}
      {children}
    </span>
  );
}
