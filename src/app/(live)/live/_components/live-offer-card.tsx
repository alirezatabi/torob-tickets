import Link from "next/link";
import { ArrowUpLeft, BadgeCheck, Clock, ExternalLink, Info, ShieldQuestion, Timer, Users } from "lucide-react";

import type { LiveOfferView } from "@/server/live-search";
import { WARNING_LABELS } from "@/domain/flight";
import { formatRelative, formatToman, toPersianDigits } from "@/lib/format";
import { formatJalaliFull } from "@/lib/jalali";
import { getCity } from "@/lib/cities";
import { cn } from "@/lib/cn";

const BADGE_LABELS: Record<string, string> = {
  best: "بهترین تطابق",
  cheapest: "ارزان‌ترین",
  fastest: "سریع‌ترین",
};

const FRESHNESS_LABELS: Record<string, { label: string; className: string; hint: string }> = {
  fresh: {
    label: "تازه",
    className: "bg-teal-50 text-teal-700 border-teal-500/30",
    hint: "این قیمت به‌تازگی از منبع خوانده شده است.",
  },
  "possibly-stale": {
    label: "احتمالاً قدیمی",
    className: "bg-saffron-50 text-saffron-700 border-saffron-300/60",
    hint: "قیمت چند دقیقه پیش دیده شده؛ ممکن است تغییر کرده باشد.",
  },
  unverified: {
    label: "تأییدنشده",
    className: "bg-ink-100 text-ink-600 border-ink-200",
    hint: "قیمت قدیمی است و موجودی آن تأیید نشده.",
  },
  unavailable: {
    label: "در دسترس نیست",
    className: "bg-danger-50 text-danger-700 border-danger-500/30",
    hint: "منبع این نرخ را در دسترس اعلام نکرده است.",
  },
  demo: {
    label: "نمونه",
    className: "bg-saffron-50 text-saffron-700 border-saffron-300/60",
    hint: "این قیمت ساخته‌شده برای نمایش است، نه قیمت واقعی.",
  },
};

const FALLBACK_FRESHNESS = { label: "تأییدنشده", className: "bg-ink-100 text-ink-600 border-ink-200", hint: "وضعیت تازگی نامشخص است." };

/**
 * One live offer, with its evidence attached.
 *
 * The card is deliberately explicit about what it does *not* know: missing flight
 * numbers, unknown baggage, foreign currency, and — most importantly — the exact time
 * the price was observed at the source. Every unknown is a visible label, not a gap.
 */
export function LiveOfferCard({ offer, index }: { offer: LiveOfferView; index: number }) {
  const origin = getCity(offer.originCity);
  const destination = getCity(offer.destinationCity);
  const freshness = FRESHNESS_LABELS[offer.freshness] ?? FALLBACK_FRESHNESS;
  const isExternal = offer.offerUrl.startsWith("http");
  const isAmadeus = offer.providerId === "amadeus";

  return (
    <article
      className="card card-hover overflow-hidden"
      style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
      data-testid="live-offer-card"
      data-offer-id={offer.id}
    >
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink-900 text-[0.62rem] font-bold text-white">
              {offer.airlineCode === "??" ? "؟" : offer.airlineCode}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink-900">{offer.airlineName}</p>
              <p className="text-[0.65rem] text-ink-400">
                {offer.flightNumber ? `پرواز ${offer.flightNumber}` : "شماره پرواز اعلام نشده"}
                {" · "}
                {offer.providerName}
              </p>
            </div>
            <span className={cn("mr-auto rounded-md border px-1.5 py-0.5 text-[0.62rem] font-medium", freshness.className)} title={freshness.hint}>
              {freshness.label}
            </span>
          </div>

          <div className="mt-3 flex items-center gap-3 text-sm">
            <div className="text-center">
              <p className="font-bold text-ink-900">{offer.departAt.slice(11, 16)}</p>
              <p className="mt-0.5 text-[0.62rem] text-ink-400">
                {offer.originAirport ?? offer.originCity} · {origin?.fa ?? offer.originCity}
              </p>
            </div>
            <div className="flex flex-1 flex-col items-center gap-1">
              <span className="inline-flex items-center gap-1 text-[0.65rem] text-ink-500">
                <Timer className="size-3" aria-hidden="true" />
                {toPersianDigits(Math.floor(offer.durationMinutes / 60))}س {toPersianDigits(offer.durationMinutes % 60)}د
              </span>
              <span className="h-px w-full bg-gradient-to-l from-transparent via-ink-300 to-transparent" />
              <span className="text-[0.62rem] text-ink-400">
                {offer.stops === 0 ? "مستقیم" : `${toPersianDigits(offer.stops)} توقف`}
              </span>
            </div>
            <div className="text-center">
              <p className="font-bold text-ink-900">{offer.arriveAt.slice(11, 16)}</p>
              <p className="mt-0.5 text-[0.62rem] text-ink-400">
                {offer.destinationAirport ?? offer.destinationCity} · {destination?.fa ?? offer.destinationCity}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[0.62rem]">
            <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-ink-600">{formatJalaliFull(offer.departAt.slice(0, 10))}</span>
            <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-ink-600">کابین: {offer.cabin}</span>
            {offer.fareClass ? <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-ink-600">کلاس نرخ: {offer.fareClass}</span> : null}
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5",
                offer.baggage.checked === "included"
                  ? "bg-teal-50 text-teal-700"
                  : offer.baggage.checked === "unknown"
                    ? "bg-saffron-50 text-saffron-700"
                    : "bg-ink-100 text-ink-600",
              )}
            >
              بار:{" "}
              {offer.baggage.checked === "included"
                ? offer.baggage.checkedKg
                  ? `${toPersianDigits(offer.baggage.checkedKg)} کیلو`
                  : "شامل"
                : offer.baggage.checked === "unknown"
                  ? "نامشخص"
                  : "ندارد"}
            </span>
            {offer.seatsAvailable !== null ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-teal-50 px-1.5 py-0.5 text-teal-700">
                <Users className="size-3" aria-hidden="true" />
                {toPersianDigits(offer.seatsAvailable)} صندلی
              </span>
            ) : null}
            {offer.badges.map((badge) => (
              <span key={badge} className="inline-flex items-center gap-1 rounded-md bg-teal-600 px-1.5 py-0.5 font-medium text-white">
                <BadgeCheck className="size-3" aria-hidden="true" />
                {BADGE_LABELS[badge] ?? badge}
              </span>
            ))}
          </div>

          {!offer.feasible && offer.violations.length > 0 ? (
            <p className="mt-2 rounded-lg bg-ink-50 px-2 py-1 text-[0.65rem] text-ink-600">
              خارج از خواستهٔ شما: {offer.violations.join(" · ")}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2 sm:w-44">
          {offer.price.comparable ? (
            <p className="text-left text-lg font-extrabold text-teal-700">{formatToman(offer.price.toman)}</p>
          ) : (
            <p className="text-left text-sm font-bold text-ink-700">
              {toPersianDigits((offer.price.amountMinor / 100).toFixed(2))} {offer.price.currency}
              <span className="block text-[0.6rem] font-normal text-ink-400">قیمت ارزی؛ قابل مقایسه با تومان نیست</span>
            </p>
          )}

          <dl className="w-full space-y-1 text-[0.62rem] text-ink-500">
            <div className="flex items-center justify-between gap-2">
              <dt className="inline-flex items-center gap-1">
                <Clock className="size-3" aria-hidden="true" />
                مشاهدهٔ قیمت
              </dt>
              <dd>{offer.priceObservedAt ? formatRelative(offer.priceObservedAt) : "نامشخص"}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="inline-flex items-center gap-1">
                <ShieldQuestion className="size-3" aria-hidden="true" />
                تأیید مجدد
              </dt>
              <dd>{offer.lastVerifiedAt ? formatRelative(offer.lastVerifiedAt) : "انجام نشده"}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt>کامل بودن داده</dt>
              <dd>{toPersianDigits(Math.round(offer.completeness * 100))}٪</dd>
            </div>
          </dl>

          <Link
            href={isExternal ? offer.offerUrl : "#"}
            target={isExternal ? "_blank" : undefined}
            rel={isExternal ? "noopener noreferrer nofollow" : undefined}
            className="btn-ghost w-full justify-center text-xs"
            title={
              isAmadeus
                ? "Amadeus یک API سازمانی است و صفحهٔ عمومی برای این نرخ ندارد؛ شناسهٔ نرخ در داده‌های منبع موجود است."
                : "صفحهٔ جست‌وجوی منبع با همین مسیر و تاریخ"
            }
          >
            {isExternal ? (
              <>
                <ExternalLink className="size-3.5" aria-hidden="true" />
                مشاهده در منبع
              </>
            ) : (
              <>
                <ArrowUpLeft className="size-3.5" aria-hidden="true" />
                {offer.providerName}
              </>
            )}
          </Link>

          <p className="w-full text-[0.58rem] leading-4 text-ink-400">
            {isExternal
              ? "لینک، صفحهٔ جست‌وجوی منبع است (نه لینک اختصاصی همین نرخ)."
              : "این منبع لینک عمومی نرخ ندارد."}
          </p>
        </div>
      </div>

      {offer.warnings.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 border-t border-ink-200/70 bg-ink-50/60 px-4 py-2">
          <Info className="size-3 text-ink-400" aria-hidden="true" />
          {offer.warnings.map((warning) => (
            <span key={warning} className="rounded bg-white px-1.5 py-0.5 text-[0.58rem] text-ink-500">
              {WARNING_LABELS[warning as keyof typeof WARNING_LABELS] ?? warning}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
