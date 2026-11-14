import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, CalendarDays, Info, Plane, Timer, Users } from "lucide-react";

import { parseSearchParams, searchHref, toSearchParams } from "@/lib/search-params";
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
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import { AirlineLogo } from "@/components/ui/airline-logo";
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

  // Crawled groups use a source-scoped canonical key, while the normalized offer keeps its
  // provider identity key. Resolve by member ID as well so the detail view finds the same group.
  const flight = view.flights.find((candidate) =>
    candidate.group.groupKey === offer.groupKey || candidate.group.offers.some((member) => member.id === offer.id),
  ) ?? null;
  const sellers = flight?.sellers ?? [];
  const origin = getCity(offer.originCode);
  const destination = getCity(offer.destinationCode);
  const originTz = origin?.timezone ?? "Asia/Tehran";
  const destinationTz = destination?.timezone ?? "Asia/Tehran";
  const arrivalNextDay = isoDateInZone(offer.arriveAt, destinationTz) !== isoDateInZone(offer.departAt, originTz);
  const compareParams = toSearchParams(query);
  compareParams.set("groups", `${offer.groupKey}:${offer.id}`);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8" data-testid="flight-page">
      <nav className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link href={searchHref(query)} className="btn-ghost text-xs">
          <ArrowRight className="size-3.5" aria-hidden="true" />
          بازگشت به نتایج
        </Link>
        <DataSourceBadge source={offer.dataSource} />
      </nav>

      {/* ——— flight identity and itinerary ——— */}
      <header className="card overflow-hidden border-ink-100 shadow-[0_24px_70px_-46px_rgba(15,35,55,0.38)]">
        <div className="relative overflow-hidden bg-[linear-gradient(120deg,#f1fbf9_0%,#ffffff_52%,#f4f8ff_100%)] p-4 sm:p-6">
          <div aria-hidden="true" className="pointer-events-none absolute -left-10 -top-16 size-52 rounded-full bg-teal-100/50 blur-3xl" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3.5 sm:gap-4">
              <div className="grid size-[3.75rem] shrink-0 place-items-center rounded-2xl border border-white bg-white shadow-sm ring-1 ring-ink-100/70 sm:size-16">
                <AirlineLogo code={offer.airlineCode} name={offer.airlineName} size={48} />
              </div>
              <div className="min-w-0 pt-0.5">
                <p className="inline-flex items-center gap-1.5 text-[0.63rem] font-bold text-teal-700">
                  جزئیات بلیت · <DataSourceBadge source={offer.dataSource} variant="inline" />
                </p>
                <h1 className="mt-1 text-lg font-black leading-7 text-ink-900 sm:text-xl" data-testid="flight-title">
                  {offer.airlineName}
                  {offer.flightNumber ? ` · پرواز ${offer.flightNumber}` : " · شمارهٔ پرواز اعلام نشده"}
                </h1>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.73rem] text-ink-600">
                  <span>{cityLabel(offer.originCode)} به {cityLabel(offer.destinationCode)}</span>
                  <span className="text-ink-300" aria-hidden="true">·</span>
                  <CalendarDays className="size-3.5 text-ink-400" aria-hidden="true" />
                  <span>{formatJalaliFull(query.departDate)}</span>
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5 text-[0.62rem] font-medium text-ink-600">
                  <span className="rounded-full border border-white bg-white/80 px-2.5 py-1 shadow-sm">{formatStopsShort(offer.stops)}</span>
                  <span className="rounded-full border border-white bg-white/80 px-2.5 py-1 shadow-sm">{formatDuration(offer.durationMinutes)}</span>
                  <span className="rounded-full border border-white bg-white/80 px-2.5 py-1 shadow-sm">{toPersianDigits(query.passengers)} مسافر</span>
                  <span className="rounded-full border border-white bg-white/80 px-2.5 py-1 shadow-sm">{CABIN_LABELS[query.cabin]}</span>
                </div>
              </div>
            </div>

            <div className="relative min-w-52 rounded-2xl border border-teal-200/80 bg-white/90 px-4 py-3 text-right shadow-[0_14px_36px_-26px_rgba(13,107,96,0.5)] sm:min-w-56 sm:px-5 sm:py-4">
              <p className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2 py-1 text-[0.61rem] font-bold text-teal-800">
                <BadgeCheck className="size-3.5" aria-hidden="true" /> ارزان‌ترین نرخ این پرواز
              </p>
              <p className="nums mt-1.5 text-xl font-black leading-8 tracking-tight text-ink-900 sm:text-2xl" data-testid="flight-cheapest">
                {flight?.selection.cheapest ? formatToman(flight.selection.cheapest.price.toman) : "تکمیل ظرفیت"}
              </p>
              {query.passengers > 1 && flight?.selection.totalToman != null ? (
                <p className="nums text-[0.64rem] text-ink-500">
                  مجموع {toPersianDigits(query.passengers)} نفر: {formatToman(flight.selection.totalToman)}
                </p>
              ) : (
                <p className="text-[0.64rem] text-ink-400">برای هر نفر</p>
              )}
              <p className="mt-2 inline-flex items-center gap-1.5 text-[0.64rem] text-ink-500">
                <Users className="size-3.5 text-teal-700" aria-hidden="true" />
                {flight?.selection.seatsAvailable != null
                  ? `${toPersianDigits(flight.selection.seatsAvailable)} صندلی در ارزان‌ترین نرخ`
                  : "ظرفیت اعلام نشده"}
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-ink-100 bg-white px-4 py-5 sm:px-6 sm:py-6">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(5.5rem,0.8fr)_minmax(0,1fr)] items-center gap-2 sm:gap-5">
            <div className="min-w-0">
              <p className="text-[0.61rem] font-semibold text-ink-400">مبدأ · {offer.originCode}</p>
              <p className="nums mt-1 text-2xl font-black tracking-tight text-ink-900 sm:text-3xl">
                {formatTimeInZone(offer.departAt, originTz)}
              </p>
              <p className="mt-0.5 truncate text-[0.72rem] font-bold text-ink-700">{origin?.fa ?? offer.originCode}</p>
              <p className="mt-0.5 truncate text-[0.6rem] text-ink-400">{origin?.airportFa ?? "فرودگاه مبدأ"}</p>
            </div>

            <div className="flex min-w-0 flex-col items-center gap-2 px-1">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-50 px-2.5 py-1 text-[0.61rem] font-semibold text-ink-600">
                <Timer className="size-3.5" aria-hidden="true" /> {formatDuration(offer.durationMinutes)}
              </span>
              <span className="flex w-full items-center" aria-hidden="true">
                <span className="size-2 shrink-0 rounded-full border-2 border-teal-600 bg-white" />
                <span className="h-[2px] flex-1 bg-gradient-to-l from-teal-500 via-ink-200 to-sky-400" />
                <Plane className="mx-1 size-4 shrink-0 -scale-x-100 text-teal-700" />
                <span className="h-[2px] flex-1 bg-gradient-to-l from-ink-200 to-sky-400" />
                <span className="size-2 shrink-0 rounded-full border-2 border-sky-500 bg-white" />
              </span>
              <span className="max-w-full truncate text-center text-[0.59rem] text-ink-400">{formatStopsShort(offer.stops)}</span>
            </div>

            <div className="min-w-0 text-left">
              <p className="text-[0.61rem] font-semibold text-ink-400">مقصد · {offer.destinationCode}</p>
              <p className="nums mt-1 text-2xl font-black tracking-tight text-ink-900 sm:text-3xl">
                {formatTimeInZone(offer.arriveAt, destinationTz)}
                {arrivalNextDay && <span className="mr-0.5 align-super text-[0.62rem] font-bold text-saffron-600">+۱ روز</span>}
              </p>
              <p className="mt-0.5 truncate text-[0.72rem] font-bold text-ink-700">{destination?.fa ?? offer.destinationCode}</p>
              <p className="mt-0.5 truncate text-[0.6rem] text-ink-400">{destination?.airportFa ?? "فرودگاه مقصد"}</p>
            </div>
          </div>
          <p className="mt-4 flex items-center gap-1.5 border-t border-ink-100 pt-3 text-[0.6rem] text-ink-400">
            <Info className="size-3.5 shrink-0" aria-hidden="true" /> ساعت‌ها به وقت محلی هر فرودگاه نمایش داده شده‌اند.
          </p>
        </div>
      </header>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="min-w-0 space-y-4">
          {/* ——— sellers ——— */}
          <section className="card p-4 sm:p-5" aria-labelledby="sellers-heading">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 id="sellers-heading" className="text-sm font-extrabold text-ink-900">
                  فروشنده‌های همین پرواز
                  <span className="mr-1.5 text-[0.67rem] font-medium text-ink-400">
                    ({toPersianDigits(sellers.length)} نرخ)
                  </span>
                </h2>
                <p className="mt-1 text-[0.66rem] leading-5 text-ink-400">
                  یک پرواز، چند نرخ؛ قیمت نهایی برای {toPersianDigits(query.passengers)} مسافر مقایسه شده است.
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-50 px-2.5 py-1 text-[0.61rem] font-semibold text-ink-500">
                <Users className="size-3.5" aria-hidden="true" /> {toPersianDigits(sellers.length)} فروشنده
              </span>
            </div>

            <ul className="mt-4 space-y-2" data-testid="seller-list">
              {sellers.map(({ offer: seller, deltaToman, cheapest }) => {
                const blocked = flight?.ineligible.find((entry) => entry.offer.id === seller.id);
                return (
                  <li
                    key={seller.id}
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-3 transition-colors sm:px-4",
                      cheapest ? "border-teal-200 bg-teal-50/60" : "border-ink-100 bg-white hover:bg-ink-50/50",
                      blocked && "opacity-75",
                    )}
                  >
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
                    <div className="min-w-36 text-left">
                      <p className="nums text-[0.9rem] font-extrabold text-ink-900 sm:text-base">{formatToman(seller.price.toman)}</p>
                      <p className="mt-0.5 text-[0.61rem] text-ink-400">
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
