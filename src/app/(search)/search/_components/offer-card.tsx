import Link from "next/link";
import { ArrowLeft, ArrowUpLeft, Briefcase, GitCompareArrows, Plane, RotateCcw, Timer } from "lucide-react";
import type { OfferGroup } from "@/domain/flight";
import { WARNING_LABELS } from "@/domain/flight";
import type { FlightOffer } from "@/domain/flight";
import type { ScoredOffer } from "@/ranking/score";
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
 * One physical flight, sold by one or more providers.
 * The card leads with the *price the user would pay* (cheapest provider) and
 * keeps every provider's own price visible underneath — that is the aggregation
 * promise made concrete.
 */
export function OfferCard({
  group,
  scored,
  index,
  selected,
  onToggleCompare,
  compareDisabled,
  muted = false,
}: {
  group: OfferGroup;
  scored: ScoredOffer | null;
  index: number;
  selected: boolean;
  onToggleCompare: () => void;
  compareDisabled?: boolean;
  muted?: boolean;
}) {
  const offer = group.primary;
  const source = sourceLinkFor(offer);
  const origin = getCity(offer.originCode);
  const destination = getCity(offer.destinationCode);
  const departTime = formatTimeInZone(offer.departAt, origin?.timezone ?? "Asia/Tehran");
  const arriveTime = formatTimeInZone(offer.arriveAt, destination?.timezone ?? "Asia/Tehran");
  // "+۱" when the arrival is on a later civil day *at the destination*.
  const arrivesNextDay =
    isoDateInZone(offer.arriveAt, destination?.timezone ?? "Asia/Tehran") !==
    isoDateInZone(offer.departAt, origin?.timezone ?? "Asia/Tehran");

  return (
    <article
      className={cn(
        "card card-hover group relative overflow-hidden",
        selected && "border-teal-500/70 ring-2 ring-teal-500/40",
        muted && "opacity-75 hover:opacity-95",
      )}
      style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
      data-testid="offer-card"
      data-group-key={group.groupKey}
    >
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 right-0 w-1 transition-colors",
          selected ? "bg-teal-500" : "bg-transparent group-hover:bg-teal-500/40",
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
            {group.providers.length > 1 && (
              <span className="mr-auto inline-flex items-center gap-1 rounded-full bg-saffron-50 px-2 py-0.5 text-[0.62rem] font-semibold text-saffron-600">
                {toPersianDigits(group.providers.length)} ارائه‌دهنده
              </span>
            )}
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
            <Feature icon={<Timer className="size-3" aria-hidden="true" />}>
              {formatRelative(offer.providerUpdatedAt)}
            </Feature>
            {offer.warnings.includes("price-converted") && (
              <span className="chip border-saffron-300/60 bg-saffron-50 text-[0.6rem] text-saffron-600" title={WARNING_LABELS["price-converted"]}>
                {offer.price.original.currency} → تومان
              </span>
            )}
          </div>

          {muted && scored && scored.violations.length > 0 && (
            <p className="mt-2 rounded-lg bg-ink-100 px-2 py-1 text-[0.62rem] leading-5 text-ink-500">
              خارج از ترجیحات: {scored.violations.join("، ")}
            </p>
          )}
        </div>

        {/* ——— Price + providers + actions ——— */}
        <div className="flex shrink-0 flex-row items-end justify-between gap-3 border-t border-ink-100 pt-3 sm:w-[13.5rem] sm:flex-col sm:items-stretch sm:border-r sm:border-t-0 sm:pr-4 sm:pt-0">
          <div className="text-left sm:text-right">
            {group.providers.length > 1 && (
              <p className="text-[0.6rem] text-ink-400">ارزان‌ترین · {toPersianDigits(group.providers.length)} منبع</p>
            )}
            <p className="text-[1.15rem] font-black tracking-tight text-ink-900 nums" data-testid="offer-price">
              {formatToman(group.cheapestToman)}
            </p>
            {scored && (
              <p className="mt-0.5 text-[0.6rem] text-ink-400">
                امتیاز تطابق {toPersianDigits(Math.round(scored.score))}
              </p>
            )}
            {group.hasPriceSpread && (
              <p className="mt-1 text-[0.6rem] font-medium text-saffron-600">
                اختلاف نرخ تا {formatToman(
                  (group.providers[group.providers.length - 1]?.priceToman ?? group.cheapestToman) - group.cheapestToman,
                )}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Link
              href={`/compare?${new URLSearchParams({ groups: `${group.groupKey}:${offer.id}` }).toString()}`}
              className="text-center text-[0.6rem] text-ink-400 hover:text-teal-700 hover:underline"
            >
              {group.providers.length > 1
                ? `مقایسهٔ ${toPersianDigits(group.providers.length)} نرخ`
                : "جزئیات نرخ"}
            </Link>

            {source.kind === "external" ? (
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="btn-primary w-full py-2 text-[0.72rem]"
                title="صفحهٔ جست‌وجوی منبع، نه لینک اختصاصی این نرخ"
              >
                مشاهده در {group.primary.providerName}
                <ArrowUpLeft className="size-3.5" aria-hidden="true" />
              </a>
            ) : (
              // Demo offers have no external page; a dead link to a placeholder domain is
              // worse than none, so the primary action stays inside the app.
              <span
                className="btn-ghost w-full cursor-default py-2 text-[0.72rem]"
                title={source.reason}
              >
                دادهٔ نمونه · {group.primary.providerName}
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

      {group.providers.length > 1 && (
        <div className="border-t border-ink-100 bg-ink-50/60 px-4 py-2">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {group.providers.map((provider) => (
              <li key={provider.offerId} className="inline-flex items-center gap-1.5 text-[0.65rem] text-ink-600">
                <span className="font-medium">{provider.providerName}</span>
                <span className="nums text-ink-800">{formatToman(provider.priceToman)}</span>
                {provider.converted && <span className="text-[0.58rem] text-saffron-600">تبدیل‌شده</span>}
                {provider.priceToman === group.cheapestToman && (
                  <span className="rounded bg-teal-100 px-1 text-[0.55rem] font-semibold text-teal-800">کمترین</span>
                )}
              </li>
            ))}
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

export function OfferCardLinkHint({ offer }: { offer: FlightOffer }) {
  return <ArrowLeft className="size-3" aria-hidden="true" aria-label={offer.providerName} />;
}
