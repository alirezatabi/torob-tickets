import Link from "next/link";
import { PopularRoutesList } from "./popular-routes-list";
import { ArrowLeft, Flame, Ticket } from "lucide-react";

import { AirlineLogo } from "@/components/ui/airline-logo";
import { getAirline } from "@/lib/airlines";
import { getCity } from "@/lib/cities";
import { formatDurationShort, formatToman, formatTomanCompact, toPersianDigits } from "@/lib/format";
import { formatJalali } from "@/lib/jalali";
import { getHomeFares, POPULAR_ROUTE_PAIRS, POPULAR_WINDOW_DAYS } from "@/server/popular-routes";

/**
 * «پرفروش‌های هفته» — the homepage's fare strip.
 *
 * A price comparison site normally fills this slot from its own sales data (“1,240 tickets sold
 * this week”). This demo has no sales, so it does not invent them: what it shows is the **cheap
 * end of the week** — the floor fare across a curated set of routes, and the cheapest fare of
 * each route next to it. Every number comes from the same `selectCheapestOffer` the results page
 * uses, so no card can advertise a fare the search will not show, and the kicker is counted from
 * the same pass as the cards instead of being estimated.
 *
 * Both entry points are honest about what they are (a price yesterday, a search today):
 *   • the headline links to the route+day whose price it quotes;
 *   • each card links to its own route and day, so the price you tap is the price you land on.
 */
export async function PopularRoutes({ limit = 6 }: { limit?: number }) {
  const { routes, week } = await getHomeFares({ limit, routes: POPULAR_ROUTE_PAIRS });
  if (routes.length === 0 || !week) return null;

  const floor = routes[0]!;
  const floorFrom = getCity(floor.originCode);
  const floorTo = getCity(floor.destinationCode);
  const floorHref = `/search?origin=${floor.originCode}&destination=${floor.destinationCode}&date=${floor.date}`;
  const windowEnd = formatJalali(floor.date);

  return (
    <section id="popular" aria-labelledby="popular-heading" className="mx-auto mt-12 max-w-6xl scroll-mt-24 rounded-[1.8rem] border border-white/90 bg-white/65 p-4 shadow-[0_24px_60px_-46px_rgba(15,35,55,0.34)] backdrop-blur sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-2xl bg-saffron-50 text-saffron-600 ring-1 ring-saffron-100">
            <Flame className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[0.62rem] font-bold tracking-wide text-saffron-700">رصد قیمت در مسیرهای منتخب</p>
            <h2 id="popular-heading" className="mt-0.5 text-sm font-extrabold text-ink-900 sm:text-base">
              پرفروش‌های هفته
            </h2>
          </div>
        </div>
        <p className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-full border border-ink-200/80 bg-white/75 px-3 py-1.5 text-[0.63rem] leading-5 text-ink-500">
          <span>ارزان‌ترین نرخِ {toPersianDigits(POPULAR_WINDOW_DAYS)} روز آینده</span>
          <span className="text-ink-300" aria-hidden="true">·</span>
          <span>رتبه بر اساس قیمت، نه آمار فروش</span>
        </p>
      </header>

      <div className="mt-5 grid gap-3.5 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        {/* The one big number: the floor fare of the week, counting the flights behind it. */}
        <Link
          href={floorHref}
          className="group relative flex min-h-[15rem] flex-col justify-between overflow-hidden rounded-[1.6rem] bg-[linear-gradient(145deg,#10283d_0%,#0d3d50_55%,#08766e_100%)] p-5 text-white shadow-[0_22px_45px_-28px_rgba(7,45,58,0.72)] transition-transform duration-200 hover:-translate-y-0.5"
          data-testid="popular-floor"
          title={`${floorFrom?.fa ?? floor.originCode} به ${floorTo?.fa ?? floor.destinationCode} — ${windowEnd} — ${formatToman(floor.priceToman)}`}
        >
          <span aria-hidden="true" className="pointer-events-none absolute -left-12 -top-14 size-48 rounded-full border border-white/[0.08]" />
          <span aria-hidden="true" className="pointer-events-none absolute -left-8 -top-8 size-32 rounded-full bg-sky-300/10 blur-2xl" />
          <span className="relative block text-[0.66rem] text-white/70">
            {toPersianDigits(week.flightsPriced)} پرواز بررسی شد
            <span className="mx-1 text-white/40">·</span>
            {toPersianDigits(week.routesPriced)} مسیر
          </span>

          <span className="relative mt-2 flex items-baseline gap-1.5">
            <span className="nums text-[1.55rem] font-black leading-none tracking-tight">
              {formatTomanCompact(floor.priceToman)}
            </span>
          </span>

          <span className="relative mt-2 flex items-center gap-1 text-[0.82rem] font-bold">
            <span className="truncate">{floorFrom?.fa ?? floor.originCode}</span>
            <ArrowLeft className="size-3.5 shrink-0 text-white/50" aria-hidden="true" />
            <span className="truncate">{floorTo?.fa ?? floor.destinationCode}</span>
          </span>
          <span className="relative mt-1 block text-[0.64rem] text-white/60">
            ارزان‌ترین نرخ هفته · {windowEnd}
            {floor.fastestMinutes !== null && ` · از ${formatDurationShort(floor.fastestMinutes)}`}
          </span>

          <span className="relative mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[0.66rem] font-semibold text-white/90 transition-colors group-hover:bg-white/20">
            <Ticket className="size-3" aria-hidden="true" />
            دیدن همان پرواز
          </span>
        </Link>

        <PopularRoutesList>
          {routes.slice(1).map((route) => {
            const from = getCity(route.originCode);
            const to = getCity(route.destinationCode);
            const airline = route.airlineCode ? getAirline(route.airlineCode) : null;
            const when = route.daysAhead === 0 ? "امروز" : route.daysAhead === 1 ? "فردا" : route.dateLabel;

            return (
              <div key={`${route.originCode}-${route.destinationCode}`}>
                <Link
                  href={`/search?origin=${route.originCode}&destination=${route.destinationCode}&date=${route.date}`}
                  className="group flex h-full min-h-[7.4rem] flex-col justify-between gap-3 rounded-2xl border border-ink-100/90 bg-[linear-gradient(145deg,#ffffff_0%,#f7fafc_100%)] p-3.5 shadow-[0_14px_30px_-26px_rgba(15,35,55,0.42)] transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-[0_18px_34px_-24px_rgba(13,107,96,0.3)]"
                  data-testid="popular-route"
                  data-route={`${route.originCode}-${route.destinationCode}`}
                  title={`${from?.fa ?? route.originCode} به ${to?.fa ?? route.destinationCode} — ${when} — ${formatToman(route.priceToman)}`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="flex min-w-0 flex-1 items-center gap-1 text-[0.8rem] font-bold text-ink-900">
                      <span className="truncate">{from?.fa ?? route.originCode}</span>
                      <ArrowLeft className="size-3 shrink-0 text-ink-300" aria-hidden="true" />
                      <span className="truncate">{to?.fa ?? route.destinationCode}</span>
                    </span>
                    {airline && <AirlineLogo code={airline.code} name={airline.fa} size={18} />}
                  </span>

                  <span className="flex items-baseline justify-between gap-2">
                    <span className="nums text-[0.95rem] font-black leading-5 text-teal-800">
                      {formatTomanCompact(route.priceToman)}
                    </span>
                    <span className="shrink-0 rounded-full bg-ink-50 px-2 py-1 text-[0.61rem] font-medium text-ink-500">{when}</span>
                  </span>
                </Link>
              </div>
            );
          })}
        </PopularRoutesList>
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-xl bg-teal-50/70 px-3 py-2 text-[0.62rem] leading-5 text-ink-500">
        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-teal-500" aria-hidden="true" />
        <span>
          بر اساس دادهٔ نمونه، ارزان‌ترین نرخِ هر مسیر در {toPersianDigits(POPULAR_WINDOW_DAYS)} روز آینده؛
          هر کارت به همان روزی می‌رود که قیمتش را نشان می‌دهد.
        </span>
      </p>
    </section>
  );
}
