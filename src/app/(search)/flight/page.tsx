import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Info, Plane, Timer, Users } from "lucide-react";

import { parseSearchParams, searchHref } from "@/lib/search-params";
import { cityLabel, getCity } from "@/lib/cities";
import { formatJalaliFull } from "@/lib/jalali";
import {
  formatDuration,
  formatStopsShort,
  formatTimeInZone,
  formatToman,
  isoDateInZone,
  toPersianDigits,
} from "@/lib/format";
import { CABIN_LABELS } from "@/domain/trip";
import { WARNING_LABELS, type FlightSegment } from "@/domain/flight";
import { searchTrips } from "@/server/search-service";
import { baggageLabel, refundLabel } from "@/ranking/explain";
import { INELIGIBLE_LABELS, LOW_SEATS_THRESHOLD } from "@/modules/pricing/select-cheapest";
import { DemoBadge } from "@/components/ui/demo-badge";
import { AirlineLogo } from "@/components/ui/airline-logo";
import { Globe } from "./_components/route-globe";
import { NO_SOURCE_REASON_FA } from "@/modules/catalog/demo-link";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "جزئیات بلیت",
  description: "همهٔ فروشنده‌های یک پرواز، بار، استرداد، توقف‌ها و ساعت‌ها در یک صفحه.",
};

interface FlightPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * One flight, in full.
 *
 * The results list is deliberately a *summary* (time, price, seats, route, carrier,
 * aircraft); everything that needs reading — every seller's price, baggage, refund terms,
 * the segment timeline, what we do not know — lives here, on a page of its own, reachable by
 * a stable URL: `/flight?origin=…&destination=…&date=…&offer=<offerId>`.
 *
 * The page never recomputes a price. It runs the same search the user came from and looks the
 * offer up in the resulting groups, so the number here is literally the number on the card.
 */
export default async function FlightPage({ searchParams }: FlightPageProps) {
  const raw = flatten(await searchParams);
  const parsed = parseSearchParams(raw);

  if (!parsed.ok) {
    return (
      <FlightProblem
        title={parsed.reason}
        hint="برای دیدن جزئیات یک بلیت، از فهرست نتایج روی «جزئیات» همان پرواز بزنید."
        backHref="/"
        backLabel="بازگشت به صفحهٔ اصلی"
      />
    );
  }

  const query = parsed.query;
  // "best" is only a ranking order; the lookup itself does not depend on it.
  const view = await searchTrips(query, "best");
  const wanted = (raw.offer ?? "").trim();

  const offer =
    (wanted ? view.outcome.offers.find((candidate) => candidate.id === wanted) : undefined) ??
    view.flights.find((flight) => flight.group.groupKey === wanted)?.selection.cheapest ??
    view.flights.find((flight) => flight.group.groupKey === wanted)?.display ??
    null;

  if (!offer) {
    return (
      <FlightProblem
        title="این بلیت در نتایج این جستجو نبود"
        hint="ممکن است تاریخ یا مسیر عوض شده باشد. از فهرست نتایج، پرواز مورد نظر را انتخاب کنید."
        backHref={searchHref(query)}
        backLabel="بازگشت به نتایج"
      />
    );
  }

  const flight = view.flights.find((candidate) => candidate.group.groupKey === offer.groupKey) ?? null;
  const sellers = flight?.sellers ?? [];
  const origin = getCity(offer.originCode);
  const destination = getCity(offer.destinationCode);
  const originTz = origin?.timezone ?? "Asia/Tehran";
  const destinationTz = destination?.timezone ?? "Asia/Tehran";
  const arrivalNextDay = isoDateInZone(offer.arriveAt, destinationTz) !== isoDateInZone(offer.departAt, originTz);
  const compareParams = new URLSearchParams({
    origin: query.originCode,
    destination: query.destinationCode,
    date: query.departDate,
    ...(query.passengers > 1 ? { pax: String(query.passengers) } : {}),
    ...(query.cabin !== "economy" ? { cabin: query.cabin } : {}),
    groups: `${offer.groupKey}:${offer.id}`,
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8" data-testid="flight-page">
      <nav className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link href={searchHref(query)} className="btn-ghost text-xs">
          <ArrowRight className="size-3.5" aria-hidden="true" />
          بازگشت به نتایج
        </Link>
        <DemoBadge />
      </nav>

      {/* ——— identity: who flies it, the two clocks, and the route on the globe ——— */}
      <header className="card overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 p-4 sm:p-5">
          <div className="flex min-w-0 items-start gap-3">
            <AirlineLogo code={offer.airlineCode} name={offer.airlineName} size={46} />
            <div className="min-w-0">
              <h1 className="text-base font-bold text-ink-900" data-testid="flight-title">
                {offer.airlineName}
                {offer.flightNumber ? ` · پرواز ${offer.flightNumber}` : " · شمارهٔ پرواز اعلام نشده"}
              </h1>
              <p className="mt-1 text-[0.75rem] text-ink-500">
                {cityLabel(offer.originCode)} به {cityLabel(offer.destinationCode)}
                <span className="mx-1.5 text-ink-300">·</span>
                {formatJalaliFull(query.departDate)}
              </p>
              <p className="mt-1 text-[0.68rem] text-ink-400">
                {offer.segments[0]?.aircraft ?? "نوع هواپیما اعلام نشده"} · {formatStopsShort(offer.stops)} ·{" "}
                {formatDuration(offer.durationMinutes)} · {toPersianDigits(query.passengers)} مسافر ·{" "}
                {CABIN_LABELS[query.cabin]}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-teal-600/20 bg-teal-50/50 px-3.5 py-2.5 text-left">
            <p className="text-[0.62rem] text-ink-500">ارزان‌ترین قیمت این پرواز</p>
            <p className="nums text-xl font-black leading-7 text-ink-900" data-testid="flight-cheapest">
              {flight?.selection.cheapest ? formatToman(flight.selection.cheapest.price.toman) : "تکمیل ظرفیت"}
            </p>
            {query.passengers > 1 && flight?.selection.totalToman != null ? (
              <p className="nums mt-0.5 text-[0.64rem] text-ink-500">
                مجموع {toPersianDigits(query.passengers)} نفر: {formatToman(flight.selection.totalToman)}
              </p>
            ) : (
              <p className="mt-0.5 text-[0.64rem] text-ink-400">برای هر نفر</p>
            )}
            <p className="mt-1 inline-flex items-center gap-1 text-[0.64rem] text-ink-500">
              <Users className="size-3" aria-hidden="true" />
              {flight?.selection.seatsAvailable != null
                ? `${toPersianDigits(flight.selection.seatsAvailable)} صندلی`
                : "ظرفیت اعلام نشده"}
            </p>
          </div>
        </div>

        {/* the two clocks, side by side with the duration between them */}
        <div className="flex items-center gap-3 border-t border-ink-100 px-4 py-3.5 sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="nums text-lg font-extrabold text-ink-900">{formatTimeInZone(offer.departAt, originTz)}</p>
            <p className="mt-0.5 truncate text-[0.66rem] text-ink-500">{origin?.fa ?? offer.originCode}</p>
            <p className="truncate text-[0.6rem] text-ink-400">{origin?.airportFa ?? ""}</p>
          </div>
          <div className="flex min-w-0 flex-[1.4] flex-col items-center gap-1">
            <span className="inline-flex items-center gap-1 text-[0.64rem] text-ink-500">
              <Timer className="size-3" aria-hidden="true" />
              {formatDuration(offer.durationMinutes)}
            </span>
            <span className="flex w-full items-center" aria-hidden="true">
              <span className="size-1.5 rounded-full bg-ink-300" />
              <span className="h-px flex-1 border-t border-dashed border-ink-300" />
              <Plane className="mx-1 size-3.5 -scale-x-100 text-ink-300" />
              <span className="h-px flex-1 border-t border-dashed border-ink-300" />
              <span className="size-1.5 rounded-full bg-teal-500" />
            </span>
            <span className="text-[0.62rem] text-ink-400">{formatStopsShort(offer.stops)}</span>
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="nums text-lg font-extrabold text-ink-900">
              {formatTimeInZone(offer.arriveAt, destinationTz)}
              {arrivalNextDay && <span className="mr-0.5 align-super text-[0.6rem] text-saffron-600">+۱ روز</span>}
            </p>
            <p className="mt-0.5 truncate text-[0.66rem] text-ink-500">{destination?.fa ?? offer.destinationCode}</p>
            <p className="truncate text-[0.6rem] text-ink-400">{destination?.airportFa ?? ""}</p>
          </div>
        </div>

        {/* ——— the route on the planet ——— */}
        {origin?.lat != null && destination?.lat != null && origin?.lon != null && destination?.lon != null && (
          <div className="border-t border-ink-100 bg-gradient-to-b from-ink-50/80 to-white px-4 py-4 sm:px-5">
            <Globe
              origin={[origin.lon, origin.lat]}
              destination={[destination.lon, destination.lat]}
              originLabel={origin.fa}
              destinationLabel={destination.fa}
            />
          </div>
        )}
      </header>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="min-w-0 space-y-4">
          {/* ——— sellers ——— */}
          <section className="card p-4" aria-labelledby="sellers-heading">
            <h2 id="sellers-heading" className="text-[0.8rem] font-bold text-ink-900">
              فروشنده‌های همین پرواز
              <span className="mr-1.5 text-[0.65rem] font-medium text-ink-400">
                ({toPersianDigits(sellers.length)} نرخ)
              </span>
            </h2>
            <p className="mt-1 text-[0.65rem] leading-5 text-ink-400">
              همهٔ این‌ها یک پروازند؛ تفاوت‌شان قیمت و شرایط نرخ است. ارزان‌ترین نرخ برای{" "}
              {toPersianDigits(query.passengers)} مسافر محاسبه شده.
            </p>

            <ul className="mt-3 divide-y divide-ink-100" data-testid="seller-list">
              {sellers.map(({ offer: seller, deltaToman, cheapest }) => {
                const blocked = flight?.ineligible.find((entry) => entry.offer.id === seller.id);
                return (
                  <li key={seller.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-[0.78rem] font-semibold text-ink-800">
                        {seller.providerName}
                        {cheapest && (
                          <span className="rounded-md bg-teal-50 px-1.5 py-0.5 text-[0.6rem] font-bold text-teal-700">
                            کمترین
                          </span>
                        )}
                        {blocked && (
                          <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-[0.6rem] font-medium text-ink-500">
                            {INELIGIBLE_LABELS[blocked.reason]}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[0.63rem] text-ink-400">
                        <span>{baggageLabel(seller)}</span>
                        <span className="text-ink-300">·</span>
                        <span>{refundLabel(seller)}</span>
                        {seller.seatsAvailable != null && (
                          <>
                            <span className="text-ink-300">·</span>
                            <span
                              className={cn(
                                seller.seatsAvailable <= LOW_SEATS_THRESHOLD ? "text-saffron-700" : "text-teal-700",
                              )}
                            >
                              {toPersianDigits(seller.seatsAvailable)} صندلی
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="text-left">
                      <p className="nums text-[0.85rem] font-bold text-ink-900">{formatToman(seller.price.toman)}</p>
                      <p className="mt-0.5 text-[0.6rem] text-ink-400">
                        {deltaToman === 0 ? "ارزان‌ترین نرخ" : `${formatToman(deltaToman)} گران‌تر`}
                        {seller.price.converted ? " · تبدیل‌شده به تومان" : ""}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>

            {sellers.length === 0 && (
              <p className="mt-3 text-[0.72rem] text-ink-500">برای این پرواز نرخی برای این تعداد مسافر نمانده است.</p>
            )}
          </section>

          {/* ——— segments ——— */}
          <section className="card p-4" aria-labelledby="segments-heading">
            <h2 id="segments-heading" className="text-[0.8rem] font-bold text-ink-900">
              پله‌های پرواز
              <span className="mr-1.5 text-[0.65rem] font-medium text-ink-400">({toPersianDigits(offer.segments.length)} پاره)</span>
            </h2>
            <ol className="mt-3 space-y-3">
              {offer.segments.map((segment, index) => (
                <SegmentRow key={`${segment.originCode}-${index}`} segment={segment} index={index} />
              ))}
            </ol>
            {offer.segments.length === 0 && (
              <p className="mt-2 text-[0.72rem] text-ink-500">منبع، جزئیات مسیر را اعلام نکرده است.</p>
            )}
          </section>

          {/* ——— what we do not know ——— */}
          <section className="card p-4" aria-labelledby="facts-heading">
            <h2 id="facts-heading" className="text-[0.8rem] font-bold text-ink-900">
              شرایط و آنچه نمی‌دانیم
            </h2>
            <dl className="mt-2 grid gap-2 text-[0.72rem] sm:grid-cols-2">
              <Fact label="بار همراه" value={baggageLabel(offer)} unknown={offer.baggage.checked === "unknown"} />
              <Fact label="شرایط استرداد" value={refundLabel(offer)} unknown={offer.refundable === null} />
              <Fact
                label="نوع هواپیما"
                value={offer.segments[0]?.aircraft ?? "اعلام نشده"}
                unknown={!offer.segments[0]?.aircraft}
              />
              <Fact
                label="تعداد فروشنده"
                value={
                  flight ? `${toPersianDigits(flight.group.providers.length)} منبع` : "نامشخص"
                }
                unknown={!flight}
              />
            </dl>

            {offer.warnings.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {offer.warnings.map((warning) => (
                  <li key={warning} className="chip border-saffron-300/60 bg-saffron-50 text-[0.62rem] text-saffron-700">
                    {WARNING_LABELS[warning]}
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-ink-50 px-3 py-2 text-[0.65rem] leading-5 text-ink-500">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {NO_SOURCE_REASON_FA} «نامشخص» یعنی منبع آن را اعلام نکرده؛ ما حدس نمی‌زنیم.
            </p>
          </section>
        </div>

        {/* ——— side: the honest actions ——— */}
        <aside className="space-y-3 lg:sticky lg:top-20">
          <div className="card p-4">
            <p className="inline-flex items-center gap-1.5 text-[0.7rem] font-semibold text-teal-700">
              <BadgeCheck className="size-3.5" aria-hidden="true" />
              مقایسه با پروازهای دیگر
            </p>
            <p className="mt-1.5 text-[0.68rem] leading-6 text-ink-500">
              همین پرواز را کنار پروازهای دیگرِ این مسیر بگذارید تا قیمت و شرایط‌شان را رو‌به‌رو ببینید.
            </p>
            <Link
              href={`/compare?${compareParams.toString()}`}
              className="btn-ghost mt-3 w-full justify-center text-[0.72rem]"
              data-testid="flight-compare-link"
            >
              افزودن به مقایسه
            </Link>
            <Link href={searchHref(query)} className="btn-primary mt-2 w-full justify-center text-[0.72rem]">
              پروازهای دیگر این مسیر
            </Link>
          </div>

          <div className="card p-4">
            <h2 className="text-[0.72rem] font-bold text-ink-800">قیمت‌ها از کجا آمده‌اند؟</h2>
            <ul className="mt-2 space-y-1.5 text-[0.65rem] leading-5 text-ink-500">
              <li>· همهٔ نرخ‌ها از دادهٔ نمونهٔ درون‌برنامه ساخته می‌شوند، نه از هیچ منبع زنده.</li>
              <li>· ارزان‌ترین نرخ با قاعدهٔ واحدِ کل محصول انتخاب شده؛ عدد این صفحه و کارت نتایج یکی است.</li>
              <li>· نرخی که برای تعداد مسافر شما ظرفیت ندارد، حذف نمی‌شود؛ با دلیلش نشان داده می‌شود.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SegmentRow({ segment, index }: { segment: FlightSegment; index: number }) {
  const from = getCity(segment.originCode);
  const to = getCity(segment.destinationCode);
  return (
    <li className="flex items-start gap-3 rounded-xl border border-ink-100 p-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink-100 text-[0.62rem] font-bold text-ink-600">
        {toPersianDigits(index + 1)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.75rem] font-semibold text-ink-800">
          {from?.fa ?? segment.originCode} → {to?.fa ?? segment.destinationCode}
        </p>
        <p className="mt-0.5 nums text-[0.65rem] text-ink-500">
          {formatTimeInZone(segment.departAt, from?.timezone ?? "Asia/Tehran")} —{" "}
          {formatTimeInZone(segment.arriveAt, to?.timezone ?? "Asia/Tehran")}
          {segment.aircraft ? ` · ${segment.aircraft}` : ""}
          {segment.flightNumber ? ` · ${segment.flightNumber}` : ""}
        </p>
      </div>
    </li>
  );
}

function Fact({ label, value, unknown }: { label: string; value: string; unknown: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-ink-100 py-1.5">
      <dt className="text-ink-400">{label}</dt>
      <dd className={cn("font-semibold", unknown ? "text-saffron-700" : "text-ink-800")}>{value}</dd>
    </div>
  );
}

function FlightProblem({
  title,
  hint,
  backHref,
  backLabel,
}: {
  title: string;
  hint: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <div className="card p-8 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-saffron-50 text-saffron-600">
          <Info className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-lg font-bold" data-testid="flight-error">
          {title}
        </h1>
        <p className="mt-2 text-sm leading-6 text-ink-500">{hint}</p>
        <Link href={backHref} className="btn-primary mt-5 text-sm">
          <ArrowRight className="size-4" aria-hidden="true" />
          {backLabel}
        </Link>
      </div>
    </div>
  );
}

function flatten(params: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value) && value[0]) out[key] = value[0];
  }
  return out;
}
