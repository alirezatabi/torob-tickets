import Link from "next/link";
import { ArrowLeft, Plane } from "lucide-react";
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

  const cities = CITIES.length;
  const routes = CITIES.reduce((total, city) => total + destinationsWithCounts(city.code).length, 0);

  return (
    <section id="routes" aria-labelledby="routes-heading" className="mt-14 scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="eyebrow">
            <Plane className="size-3.5" aria-hidden="true" />
            پوشش مسیرها
          </span>
          <h2 id="routes-heading" className="mt-2 text-lg font-extrabold text-ink-900 sm:text-xl">
            {toPersianDigits(cities)} شهر، {toPersianDigits(routes)} مسیر پروازی
          </h2>
          <p className="mt-1.5 max-w-xl text-[0.8rem] leading-6 text-ink-500">
            از پروازهای داخلی تا اروپا و آسیای میانه؛ روی هر مقصد بزنید تا قیمت‌های همان روز مقایسه
            شود.
          </p>
        </div>
        <span className="chip border-teal-200 bg-teal-50 text-teal-700">پرواز رفت و برگشت هم پشتیبانی می‌شود</span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {origins.map(({ city, destinations }) => (
          <article key={city.code} className="card card-hover p-4">
            <header className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="grid size-9 place-items-center rounded-xl bg-ink-900 text-[0.62rem] font-bold text-white">
                  {city.code}
                </span>
                <div>
                  <h3 className="text-[0.85rem] font-bold text-ink-900">{city.fa}</h3>
                  <p className="text-[0.65rem] text-ink-400">{city.countryFa}</p>
                </div>
              </div>
              <span className="nums text-[0.65rem] font-medium text-teal-700">
                {toPersianDigits(destinations.length)} مقصد
              </span>
            </header>

            <ul className="mt-3 flex flex-wrap gap-1.5">
              {destinations.slice(0, 6).map((destination) => {
                const target = getCity(destination.code);
                if (!target) return null;
                return (
                  <li key={destination.code}>
                    <Link
                      href={`/search?origin=${city.code}&destination=${destination.code}&date=${date}`}
                      className="group inline-flex items-center gap-1 rounded-full border border-ink-200 bg-white px-2.5 py-1 text-[0.7rem] text-ink-600 transition-colors hover:border-teal-400 hover:bg-teal-50 hover:text-teal-800"
                      title={`${city.fa} به ${target.fa} — ${toPersianDigits(destination.patterns)} پرواز در هفته`}
                    >
                      {target.fa}
                      <ArrowLeft
                        className="size-2.5 opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                );
              })}
              {destinations.length > 6 && (
                <li>
                  <Link
                    href={`/search?origin=${city.code}&destination=${destinations[0]?.code ?? ""}&date=${date}`}
                    className="inline-flex items-center rounded-full bg-ink-100 px-2.5 py-1 text-[0.7rem] font-medium text-ink-600 hover:bg-ink-200"
                  >
                    و {toPersianDigits(destinations.length - 6)} مقصد دیگر
                  </Link>
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
    <details className="card mt-3 px-4 py-3">
      <summary className="cursor-pointer text-[0.78rem] font-semibold text-ink-700 marker:text-teal-600">
        فهرست کامل {toPersianDigits(CITIES.length)} شهر تحت پوشش
      </summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...grouped.entries()].map(([country, cities]) => (
          <div key={country}>
            <p className="text-[0.65rem] font-bold text-ink-400">{country}</p>
            <p className="mt-1 text-[0.7rem] leading-6 text-ink-600">
              {cities.map((city, index) => (
                <span key={city.code}>
                  <Link
                    href={`/search?origin=THR&destination=${city.code}&date=${date}`}
                    className="hover:text-teal-700 hover:underline"
                  >
                    {city.fa}
                  </Link>
                  {index < cities.length - 1 ? "، " : ""}
                </span>
              ))}
            </p>
          </div>
        ))}
      </div>
    </details>
  );
}
