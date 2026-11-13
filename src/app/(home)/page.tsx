import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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
    <div className="relative overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[38rem]">
        <div className="mesh absolute inset-0 opacity-80" />
        <div className="grid-lines absolute inset-0 opacity-30" />
        <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-b from-transparent to-ink-50" />
      </div>

      <Hero
        badge={`${toPersianDigits(providers.length)} منبع قیمت · ${toPersianDigits(airlineCount())} ایرلاین · بدون قیمت ساختگی`}
      >
        <SearchForm />
      </Hero>

      <div className="mx-auto max-w-6xl px-4 pb-6 sm:px-6">
        <DemoSearches />

        {/* Numbers, not prose: the coverage claim is the metric itself. */}
        <dl className="mx-auto mt-8 grid max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-ink-200 bg-ink-200 sm:grid-cols-4">
          <Metric value={toPersianDigits(providers.length)} label="منبع قیمت" />
          <Metric value={toPersianDigits(routeCount())} label="مسیر" />
          <Metric value={toPersianDigits(servedCities().length)} label="شهر" />
          <Metric value={toPersianDigits(airlineCount())} label="ایرلاین" />
        </dl>

        {/* Cheap fares now, not a “best seller” badge: the demo has no sales to count. */}
        <PopularRoutes />

        <RouteExplorer />
        <CityIndex />

        <div className="mx-auto mt-8 flex max-w-4xl flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[0.68rem] text-ink-400">
          <span>دادهٔ نمونه</span>
          <span aria-hidden="true">·</span>
          <span>{toPersianDigits(CITIES.length)} شهر در کاتالوگ</span>
          <span aria-hidden="true">·</span>
          <Link href="/live" className="inline-flex items-center gap-1 font-semibold text-teal-700 hover:underline">
            مقایسهٔ تفصیلی یک پرواز
            <ArrowLeft className="size-3" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-white px-4 py-4 text-center">
      <dd className="nums text-[1.45rem] font-extrabold leading-none tracking-tight text-ink-900">{value}</dd>
      <dt className="mt-1.5 text-[0.68rem] text-ink-400">{label}</dt>
    </div>
  );
}
