import Link from "next/link";
import { Plane } from "lucide-react";
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
    <section id="routes" aria-labelledby="routes-heading" className="mt-14 scroll-mt-24">
      <h2 id="routes-heading" className="flex items-center gap-2 text-[0.95rem] font-bold text-ink-900">
        <Plane className="size-4 text-teal-600" aria-hidden="true" />
        مسیرهای پرتردد
      </h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {origins.map(({ city, destinations }) => (
          <article key={city.code} className="card card-hover p-3.5">
            <header className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-lg bg-ink-900 text-[0.58rem] font-bold text-white">
                  {city.code}
                </span>
                <h3 className="text-[0.82rem] font-bold text-ink-900">{city.fa}</h3>
              </div>
              <span className="nums text-[0.62rem] font-medium text-ink-400">
                {toPersianDigits(destinations.length)}
              </span>
            </header>

            <ul className="mt-2.5 flex flex-wrap gap-1">
              {destinations.slice(0, 6).map((destination) => {
                const target = getCity(destination.code);
                if (!target) return null;
                return (
                  <li key={destination.code}>
                    <Link
                      href={`/search?origin=${city.code}&destination=${destination.code}&date=${date}`}
                      className="inline-flex rounded-md bg-ink-50 px-2 py-1 text-[0.68rem] text-ink-600 transition-colors hover:bg-teal-50 hover:text-teal-800"
                      title={`${city.fa} ← ${target.fa} · ${toPersianDigits(destination.patterns)} پرواز در هفته`}
                    >
                      {target.fa}
                    </Link>
                  </li>
                );
              })}
              {destinations.length > 6 && (
                <li>
                  <a
                    href="#city-index"
                    className="inline-flex rounded-md px-2 py-1 text-[0.68rem] font-semibold text-teal-700 hover:bg-teal-50"
                    title="فهرست کامل شهرها"
                  >
                    +{toPersianDigits(destinations.length - 6)}
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
    <details id="city-index" className="card mt-3 scroll-mt-24 px-4 py-3">
      <summary className="cursor-pointer text-[0.72rem] font-medium text-ink-500 marker:text-teal-600">
        {toPersianDigits(CITIES.length)} شهر
        <span className="mx-1 text-ink-300">·</span>
        <span className="text-ink-400">فهرست کامل</span>
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
