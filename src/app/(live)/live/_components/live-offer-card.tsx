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

const CABIN_SHORT: Record<string, string> = { economy: "اکونومی", premium: "پرمیوم", business: "بیزنس", first: "فرست" };

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
              <p className="nums text-[0.64rem] text-ink-400">
                {offer.flightNumber ?? "بدون شماره"}
                <span className="mx-1 text-ink-300">·</span>
                {offer.providerName}
              </p>
            </div>
            <span className={cn("mr-auto rounded-md border px-1.5 py-0.5 text-[0.62rem] font-medium", freshness.className)} title={freshness.hint}>
              {freshness.label}
            </span>
          </div>

          <div className="mt-3 flex items-center gap-3 text-sm">
            <div className="text-center">
              <p className="nums font-bold text-ink-900">{offer.departAt.slice(11, 16)}</p>
              <p className="mt-0.5 text-[0.6rem] text-ink-400">
                {offer.originAirport && offer.originAirport !== offer.originCity
                  ? `${offer.originAirport} · ${origin?.fa ?? offer.originCity}`
                  : (origin?.fa ?? offer.originCity)}
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
              <p className="nums font-bold text-ink-900">{offer.arriveAt.slice(11, 16)}</p>
              <p className="mt-0.5 text-[0.6rem] text-ink-400">
                {offer.destinationAirport && offer.destinationAirport !== offer.destinationCity
                  ? `${offer.destinationAirport} · ${destination?.fa ?? offer.destinationCity}`
                  : (destination?.fa ?? offer.destinationCity)}
              </p>
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1 text-[0.62rem]">
            <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-ink-600">{formatJalaliFull(offer.departAt.slice(0, 10))}</span>
            <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-ink-600">{CABIN_SHORT[offer.cabin] ?? offer.cabin}</span>
            {offer.fareClass ? <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-ink-600">{offer.fareClass}</span> : null}
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
            <div className="text-left">
              <p className="text-sm font-bold text-ink-700">
                <span dir="ltr">{toPersianDigits((offer.price.amountMinor / 100).toFixed(2))}</span>{" "}
                {offer.price.currency}
              </p>
              <p className="text-[0.6rem] font-normal text-ink-400">قیمت ارزی؛ قابل مقایسه با تومان نیست</p>
            </div>
          )}

          <dl className="grid w-full grid-cols-3 gap-1 rounded-lg bg-ink-50/80 px-1.5 py-1.5 text-center text-[0.58rem] text-ink-400">
            <div>
              <dt className="inline-flex items-center gap-0.5">
                <Clock className="size-2.5" aria-hidden="true" />
                مشاهدهٔ قیمت
              </dt>
              <dd className="mt-0.5 font-medium text-ink-600">
                {offer.priceObservedAt ? formatRelative(offer.priceObservedAt) : "—"}
              </dd>
            </div>
            <div className="border-x border-ink-200/70">
              <dt className="inline-flex items-center gap-0.5">
                <ShieldQuestion className="size-2.5" aria-hidden="true" />
                تأیید مجدد
              </dt>
              <dd className="mt-0.5 font-medium text-ink-600">
                {offer.lastVerifiedAt ? formatRelative(offer.lastVerifiedAt) : "انجام نشده"}
              </dd>
            </div>
            <div>
              <dt>کامل بودن</dt>
              <dd className="mt-0.5 font-medium text-ink-600 nums">
                {toPersianDigits(Math.round(offer.completeness * 100))}٪
              </dd>
            </div>
          </dl>

          <Link
            href={isExternal ? offer.offerUrl : "#"}
            target={isExternal ? "_blank" : undefined}
            rel={isExternal ? "noopener noreferrer nofollow" : undefined}
            className="btn-ghost w-full justify-center text-[0.72rem]"
            title={isAmadeus ? "API سازمانی؛ صفحهٔ عمومی نرخ ندارد" : "صفحهٔ جست‌وجوی منبع، نه لینک اختصاصی نرخ"}
          >
            {isExternal ? (
              <>
                <ExternalLink className="size-3" aria-hidden="true" />
                منبع
              </>
            ) : (
              <>
                <ArrowUpLeft className="size-3" aria-hidden="true" />
                {offer.providerName}
              </>
            )}
          </Link>

          <p className="w-full text-[0.56rem] leading-4 text-ink-400">
            {isExternal
              ? "لینک، صفحهٔ جست‌وجوی منبع است، نه همین نرخ."
              : "این منبع لینک عمومی نرخ ندارد."}
          </p>
        </div>
      </div>

      {offer.warnings.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 border-t border-ink-200/60 px-4 py-1.5">
          <Info className="size-2.5 text-ink-300" aria-hidden="true" />
          {offer.warnings.map((warning) => (
            <span key={warning} className="text-[0.56rem] text-ink-400">
              {WARNING_LABELS[warning as keyof typeof WARNING_LABELS] ?? warning}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
