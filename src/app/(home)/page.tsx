import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, Building2, Database, MapPin, Plane, Route } from "lucide-react";
import { DemoSearches } from "@/app/(home)/_components/demo-searches";
import { RouteExplorer, CityIndex } from "@/app/(home)/_components/route-explorer";
import { PopularRoutes } from "@/app/(home)/_components/popular-routes";
import { Hero } from "@/app/(home)/_components/hero";
import { SearchForm } from "@/app/(home)/_components/search-form";
import { listProviders } from "@/providers/registry";
import { airlineCount } from "@/lib/airlines";
import { routeCount, servedCities } from "@/lib/schedules";
import { CITIES } from "@/lib/cities";
import { toPersianDigits } from "@/lib/format";

/**
 * The fare strip prices the *current* week, so the page cannot be a build-time snapshot.
 * A short revalidate keeps the homepage fast (prerendered) without freezing last week's prices:
 * at most 15 minutes stale, and the card's link carries the day it priced, so a tap can never
 * land on a different date than the one shown.
 */
export const revalidate = 900;

export default function HomePage() {
  const providers = listProviders();

  return (
    <div className="relative">
      <Hero
        badge={`${toPersianDigits(providers.length)} منبع قیمت · ${toPersianDigits(airlineCount())} ایرلاین · بدون قیمت ساختگی`}
      >
        <SearchForm />
      </Hero>

      <section className="relative isolate overflow-hidden bg-[linear-gradient(180deg,#f2f7fb_0%,#f8fafc_36%,#f1f7f7_100%)]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -right-40 top-12 size-[28rem] rounded-full bg-sky-100/55 blur-[100px]" />
          <div className="absolute -left-40 top-[38rem] size-[30rem] rounded-full bg-teal-100/45 blur-[110px]" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-l from-transparent via-sky-200 to-transparent" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-5 sm:px-6 sm:pt-8 lg:px-8">
          <DemoSearches />

          <section aria-labelledby="coverage-heading" className="mx-auto mt-9 max-w-6xl">
            <div className="flex flex-wrap items-end justify-between gap-2 px-1">
              <div>
                <p className="text-[0.62rem] font-bold tracking-wide text-teal-700">پوشش جست‌وجو</p>
                <h2 id="coverage-heading" className="mt-1 text-sm font-extrabold text-ink-900 sm:text-base">
                  مقایسه از چند منبع، در یک نگاه
                </h2>
              </div>
              <p className="text-[0.65rem] text-ink-400">داده‌ها نمونه‌اند؛ قیمت نهایی را در نتایج ببینید.</p>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric value={toPersianDigits(providers.length)} label="منبع قیمت" icon={<Database className="size-4" />} />
              <Metric value={toPersianDigits(routeCount())} label="مسیر قابل جست‌وجو" icon={<Route className="size-4" />} />
              <Metric value={toPersianDigits(servedCities().length)} label="شهر تحت پوشش" icon={<MapPin className="size-4" />} />
              <Metric value={toPersianDigits(airlineCount())} label="ایرلاین" icon={<Plane className="size-4" />} />
            </dl>
          </section>

          <PopularRoutes />
          <RouteExplorer />
          <CityIndex />

          <footer className="mx-auto mt-8 flex max-w-6xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/90 bg-white/65 px-4 py-3 shadow-[0_12px_30px_-26px_rgba(15,35,55,0.3)] backdrop-blur sm:px-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.66rem] text-ink-500">
              <span className="inline-flex items-center gap-1.5 font-semibold text-ink-700">
                <Building2 className="size-3.5 text-teal-600" aria-hidden="true" />
                {toPersianDigits(CITIES.length)} شهر در کاتالوگ
              </span>
              <span className="hidden text-ink-300 sm:inline" aria-hidden="true">•</span>
              <span>دادهٔ نمونه، بدون آمار فروش ساختگی</span>
            </div>
            <Link href="/live" className="group inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1.5 text-[0.67rem] font-bold text-teal-800 transition-colors hover:bg-teal-100">
              مقایسهٔ تفصیلی یک پرواز
              <ArrowLeft className="size-3 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
            </Link>
          </footer>
        </div>
      </section>
    </div>
  );
}

function Metric({ value, label, icon }: { value: string; label: string; icon: ReactNode }) {
  return (
    <div className="group flex min-h-[4.75rem] items-center gap-3 rounded-2xl border border-white/90 bg-white/80 px-3.5 py-3 shadow-[0_12px_30px_-26px_rgba(15,35,55,0.3)] transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-[0_16px_32px_-24px_rgba(13,107,96,0.28)] sm:px-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700 ring-1 ring-teal-100/80 transition-colors group-hover:bg-teal-600 group-hover:text-white">
        {icon}
      </span>
      <div>
        <dd className="nums text-[1.2rem] font-black leading-none tracking-tight text-ink-900 sm:text-[1.35rem]">{value}</dd>
        <dt className="mt-1.5 text-[0.65rem] font-medium text-ink-500">{label}</dt>
      </div>
    </div>
  );
}
