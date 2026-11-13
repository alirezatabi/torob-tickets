import Link from "next/link";
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
    <section id="popular" aria-labelledby="popular-heading" className="mx-auto mt-12 max-w-5xl scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-1">
        <h2 id="popular-heading" className="flex items-center gap-2 text-[0.95rem] font-bold text-ink-900">
          <Flame className="size-4 text-saffron-500" aria-hidden="true" />
          پرفروش‌های هفته
        </h2>
        <p className="text-[0.65rem] leading-5 text-ink-400">
          ارزان‌ترین نرخِ {toPersianDigits(POPULAR_WINDOW_DAYS)} روز آینده
          <span className="mx-1.5 text-ink-300">·</span>
          رتبه بر اساس قیمت، نه آمار فروش
        </p>
      </div>

      <div className="mt-3 grid gap-2.5 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        {/* The one big number: the floor fare of the week, counting the flights behind it. */}
        <Link
          href={floorHref}
          className="group relative overflow-hidden rounded-2xl bg-ink-900 p-4 text-white transition-shadow hover:shadow-[0_18px_34px_-24px_rgb(11_20_36_/_0.75)]"
          data-testid="popular-floor"
          title={`${floorFrom?.fa ?? floor.originCode} به ${floorTo?.fa ?? floor.destinationCode} — ${windowEnd} — ${formatToman(floor.priceToman)}`}
        >
          <span aria-hidden="true" className="mesh absolute inset-0 opacity-25" />
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

        <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3" data-testid="popular-routes">
          {routes.slice(1).map((route) => {
            const from = getCity(route.originCode);
            const to = getCity(route.destinationCode);
            const airline = route.airlineCode ? getAirline(route.airlineCode) : null;
            const when = route.daysAhead === 0 ? "امروز" : route.daysAhead === 1 ? "فردا" : route.dateLabel;

            return (
              <li key={`${route.originCode}-${route.destinationCode}`}>
                <Link
                  href={`/search?origin=${route.originCode}&destination=${route.destinationCode}&date=${route.date}`}
                  className="card card-hover group flex h-full flex-col justify-between gap-2 p-3"
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
                    <span className="nums text-[0.92rem] font-extrabold leading-5 text-ink-900">
                      {formatTomanCompact(route.priceToman)}
                    </span>
                    <span className="shrink-0 text-[0.62rem] text-ink-400">{when}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="mt-2 px-1 text-[0.62rem] leading-5 text-ink-400">
        بر اساس دادهٔ نمونه، ارزان‌ترین نرخِ هر مسیر در {toPersianDigits(POPULAR_WINDOW_DAYS)} روز آینده؛
        هر کارت به همان روزی می‌رود که قیمتش را نشان می‌دهد.
      </p>
    </section>
  );
}
