import Link from "next/link";
import { ArrowLeft, ChevronDown, Globe2, MapPin, Plane } from "lucide-react";
import { CITIES, getCity, type City } from "@/lib/cities";
import { destinationsWithCounts } from "@/lib/schedules";
import { addDays, isoToday } from "@/lib/jalali";
import { toPersianDigits } from "@/lib/format";

/**
 * "Where can I fly?" explorer.
 *
 * Built entirely from the demo timetable (`destinationsWithCounts`), so it can
 * never advertise a route the search cannot serve. Pure links → works without JS.
 */
export function RouteExplorer({ limit = 6 }: { limit?: number }) {
  const date = addDays(isoToday(), 7);
  const origins = CITIES.map((city) => ({ city, destinations: destinationsWithCounts(city.code) }))
    .filter((entry) => entry.destinations.length > 0)
    .sort((a, b) => b.destinations.length - a.destinations.length)
    .slice(0, limit);

  return (
    <section id="routes" aria-labelledby="routes-heading" className="mx-auto mt-14 max-w-6xl scroll-mt-24">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-2xl bg-sky-50 text-sky-700 ring-1 ring-sky-100">
            <Plane className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[0.62rem] font-bold tracking-wide text-sky-700">از کجا به کجا؟</p>
            <h2 id="routes-heading" className="mt-0.5 text-sm font-extrabold text-ink-900 sm:text-base">
              مسیرهای پرتردد
            </h2>
          </div>
        </div>
        <p className="text-[0.66rem] text-ink-400">مقصدها از برنامهٔ پروازهای نمونه انتخاب شده‌اند.</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {origins.map(({ city, destinations }) => (
          <article
            key={city.code}
            className="group relative overflow-hidden rounded-[1.5rem] border border-white/90 bg-[linear-gradient(145deg,rgba(255,255,255,0.96),rgba(245,249,252,0.9))] p-4 shadow-[0_16px_36px_-30px_rgba(15,35,55,0.42)] transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-[0_20px_38px_-28px_rgba(25,95,130,0.24)]"
          >
            <span aria-hidden="true" className="pointer-events-none absolute -left-8 -top-9 size-24 rounded-full bg-sky-100/55 blur-2xl transition-colors group-hover:bg-teal-100/70" />
            <header className="relative flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-[0.9rem] bg-ink-900 text-[0.6rem] font-extrabold text-white shadow-[0_7px_14px_-10px_rgba(11,20,36,0.8)]">
                  {city.code}
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-[0.84rem] font-extrabold text-ink-900">{city.fa}</h3>
                  <p className="mt-0.5 text-[0.61rem] text-ink-400">مبدأ پرواز</p>
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ink-200/80 bg-white/85 px-2.5 py-1.5 text-[0.62rem] font-semibold text-ink-500">
                <MapPin className="size-3 text-teal-600" aria-hidden="true" />
                {toPersianDigits(destinations.length)} مقصد
              </span>
            </header>

            <div aria-hidden="true" className="relative my-3 h-px bg-gradient-to-l from-transparent via-ink-200/80 to-transparent" />

            <ul className="relative flex flex-wrap gap-1.5">
              {destinations.slice(0, 6).map((destination) => {
                const target = getCity(destination.code);
                if (!target) return null;
                return (
                  <li key={destination.code}>
                    <Link
                      href={`/search?origin=${city.code}&destination=${destination.code}&date=${date}`}
                      className="group/destination inline-flex items-center gap-1.5 rounded-xl border border-ink-200/70 bg-white/90 px-2.5 py-1.5 text-[0.68rem] font-medium text-ink-600 transition-[border-color,background-color,color] hover:border-teal-200 hover:bg-teal-50 hover:text-teal-800"
                      title={`${city.fa} ← ${target.fa} · ${toPersianDigits(destination.patterns)} پرواز در هفته`}
                    >
                      <span className="truncate">{target.fa}</span>
                      <ArrowLeft className="size-3 shrink-0 text-ink-300 transition-transform group-hover/destination:-translate-x-0.5 group-hover/destination:text-teal-600" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
              {destinations.length > 6 && (
                <li>
                  <a
                    href="#city-index"
                    className="inline-flex items-center rounded-xl border border-dashed border-teal-200 bg-teal-50/60 px-2.5 py-1.5 text-[0.67rem] font-bold text-teal-800 transition-colors hover:bg-teal-100"
                    title="فهرست کامل شهرها"
                  >
                    +{toPersianDigits(destinations.length - 6)} مقصد
                  </a>
                </li>
              )}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

/** Compact "all cities" list, used as a coverage receipt under the explorer. */
export function CityIndex() {
  const date = addDays(isoToday(), 7);
  const grouped = new Map<string, City[]>();
  for (const city of CITIES) {
    const key = city.countryFa;
    grouped.set(key, [...(grouped.get(key) ?? []), city]);
  }

  return (
    <details id="city-index" className="group mx-auto mt-4 max-w-6xl scroll-mt-24 overflow-hidden rounded-[1.5rem] border border-white/90 bg-white/75 shadow-[0_16px_38px_-32px_rgba(15,35,55,0.4)] backdrop-blur">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 transition-colors hover:bg-white/80 [&::-webkit-details-marker]:hidden sm:px-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-violet-50 text-violet-700 ring-1 ring-violet-100">
          <Globe2 className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.78rem] font-extrabold text-ink-900">
            فهرست شهرها
            <span className="mr-2 rounded-full bg-ink-50 px-2 py-0.5 text-[0.62rem] font-bold text-ink-500">
              {toPersianDigits(CITIES.length)} شهر
            </span>
          </span>
          <span className="mt-1 block text-[0.64rem] text-ink-400">برای دیدن مقصدها به تفکیک کشور باز کنید</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-ink-400 transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
      </summary>

      <div className="border-t border-ink-100/80 px-4 pb-5 pt-4 sm:px-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...grouped.entries()].map(([country, cities]) => (
            <div key={country}>
              <p className="mb-2 flex items-center gap-1.5 text-[0.66rem] font-bold text-ink-500">
                <span className="size-1.5 rounded-full bg-violet-400" aria-hidden="true" />
                {country}
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {cities.map((city) => (
                  <li key={city.code}>
                    <Link
                      href={`/search?origin=THR&destination=${city.code}&date=${date}`}
                      className="inline-flex rounded-lg border border-ink-100 bg-ink-50/80 px-2.5 py-1.5 text-[0.67rem] text-ink-600 transition-colors hover:border-teal-200 hover:bg-teal-50 hover:text-teal-800"
                    >
                      {city.fa}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
