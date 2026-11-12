import type { Metadata } from "next";
import Link from "next/link";
import { ChartLine, Info } from "lucide-react";

import {
  getPriceHistory,
  HISTORY_RANGE_LABELS_FA,
  type HistoryRange,
  type HistorySeries,
} from "@/modules/history/price-history";
import { getCity } from "@/lib/cities";
import { formatRelative, formatToman, toPersianDigits } from "@/lib/format";
import { HistoryChart } from "./_components/history-chart";
import { RangeTabs } from "./_components/range-tabs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تاریخچهٔ قیمت | ترب بلیت",
  description: "تغییر قیمت همان نرخ، در بازه‌های زمانی مختلف؛ بدون درهم‌آمیختن شرایط متفاوت بلیت.",
};

const RANGES: HistoryRange[] = ["24h", "7d", "30d", "90d", "all"];

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = flatten(await searchParams);
  const range = RANGES.includes(raw.range as HistoryRange) ? (raw.range as HistoryRange) : "30d";

  const result = await getPriceHistory({
    offerKey: raw.offerKey,
    groupKey: raw.groupKey,
    originCity: raw.origin?.toUpperCase(),
    destinationCity: raw.destination?.toUpperCase(),
    departDate: raw.date,
    range,
  });

  const origin = raw.origin ? getCity(raw.origin.toUpperCase()) : null;
  const destination = raw.destination ? getCity(raw.destination.toUpperCase()) : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-2 text-xl font-extrabold text-ink-900">
            <ChartLine className="size-5 text-teal-600" aria-hidden="true" />
            تاریخچهٔ قیمت
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {origin && destination ? `${origin.fa} → ${destination.fa}` : "همهٔ مسیرها"}
            {raw.date ? ` · ${raw.date}` : ""}
          </p>
        </div>
        <RangeTabs ranges={RANGES} current={range} params={raw} />
      </header>

      {!result.available ? (
        <div className="card mt-6 p-8 text-center">
          <Info className="mx-auto size-5 text-ink-400" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-bold">تاریخچه‌ای برای نمایش نیست</h2>
          <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-ink-500">{result.reasonFa}</p>
          <p className="mx-auto mt-2 max-w-md text-[0.65rem] leading-5 text-ink-400">
            تاریخچه از اولین مشاهدهٔ واقعی شروع می‌شود؛ هیچ داده‌ای برای پر کردن گذشته ساخته نمی‌شود.
          </p>
          <Link href="/live" className="btn-ghost mt-4 inline-flex text-xs">
            بازگشت به جست‌وجوی واقعی
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-4 text-[0.68rem] text-ink-500">
            {toPersianDigits(result.series.length)} نرخ مستقل · {toPersianDigits(result.pointCount)} مشاهده در بازهٔ{" "}
            {HISTORY_RANGE_LABELS_FA[result.range]}
          </p>

          <div className="mt-3 space-y-4">
            {result.series.map((series) => (
              <SeriesCard key={`${series.providerId}:${series.offerKey}`} series={series} />
            ))}
          </div>

          <p className="mt-6 rounded-xl border border-ink-200 bg-white px-4 py-3 text-[0.65rem] leading-5 text-ink-500">
            هر خط نمایندهٔ یک نرخ مشخص است: مسیر، تاریخ، ایرلاین، شمارهٔ پرواز، کابین، کلاس نرخ، بار مجاز و نوع
            بلیت در هویت آن اثر دارند. دو نرخی که شرایطشان متفاوت است هرگز روی یک خط نمی‌آیند و نقطه‌ای برای
            پر کردن فاصله‌ها ساخته نمی‌شود.
          </p>
        </>
      )}
    </div>
  );
}

function SeriesCard({ series }: { series: HistorySeries }) {
  return (
    <article className="card p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-ink-900">
            {series.airlineCode === "??" ? "ایرلاین نامشخص" : series.airlineCode}
            {series.flightNumber ? ` · ${series.flightNumber}` : " · بدون شمارهٔ پرواز"}
          </h2>
          <p className="mt-0.5 text-[0.65rem] text-ink-500">
            {series.originAirport ?? "?"} → {series.destinationAirport ?? "?"} · {series.departDate} · کابین{" "}
            {series.cabin}
            {series.fareClass ? ` · کلاس ${series.fareClass}` : ""} · بار {series.baggageSignature} · {series.ticketType}
          </p>
        </div>
        <div className="text-left">
          <p className="text-sm font-bold text-teal-700">{formatToman(series.points.at(-1)?.priceToman ?? 0)}</p>
          {series.changePct !== null ? (
            <p className={series.changePct > 0 ? "text-[0.62rem] text-danger-600" : "text-[0.62rem] text-teal-700"}>
              {series.changePct > 0 ? "+" : ""}
              {toPersianDigits(series.changePct)}٪ از اولین مشاهده
            </p>
          ) : (
            <p className="text-[0.62rem] text-ink-400">فقط یک مشاهده</p>
          )}
        </div>
      </header>

      <HistoryChart points={series.points} />

      <footer className="mt-2 flex flex-wrap justify-between gap-2 text-[0.6rem] text-ink-400">
        <span>اولین مشاهده: {formatRelative(series.firstObservedAt)}</span>
        <span>آخرین مشاهده: {formatRelative(series.lastObservedAt)}</span>
        <span>
          کمینه {formatToman(series.minToman)} · بیشینه {formatToman(series.maxToman)}
        </span>
      </footer>
    </article>
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
