import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Database, PlugZap, Radio, ShieldCheck } from "lucide-react";

import { parseSearchParams } from "@/lib/search-params";
import { addDays, formatJalaliFull, isoToday } from "@/lib/jalali";
import { getCity } from "@/lib/cities";
import { toPersianDigits } from "@/lib/format";
import { describeLiveProviders, searchMode } from "@/modules/providers/registry-live";
import { dbMode } from "@/modules/db/prisma";
import { runLiveSearch } from "@/server/live-search";
import { LiveOfferCard } from "./_components/live-offer-card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "دادهٔ واقعی | ترب بلیت",
  description: "جست‌وجوی قیمت پرواز از منابع واقعی، با زمان مشاهدهٔ قیمت و وضعیت هر منبع.",
};

/**
 * The live surface, deliberately a separate page.
 *
 * The demo experience keeps its own visual identity and its own honesty badge; this page
 * is where real (or explicitly-labelled sample) provider data lives, so the two can
 * never be confused — in the UI or in the database (`Provider.mode`).
 *
 * With no `origin`/`destination` it renders the provider-status dashboard instead of a
 * search, which is the most useful thing to see first.
 */
export default async function LivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = flatten(await searchParams);
  const mode = searchMode();
  const providers = describeLiveProviders();
  const hasQuery = Boolean(raw.origin && raw.destination && raw.date);
  const parsed = hasQuery ? parseSearchParams(raw, { date: addDays(isoToday(), 7) }) : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink-900">قیمت‌های واقعی</h1>
          <p className="mt-1 text-sm leading-6 text-ink-500">
            قیمت‌ها از منابع بیرونی خوانده می‌شوند؛ زمان مشاهدهٔ هر قیمت، منبع آن و آنچه دربارهٔ آن نرخ
            نمی‌دانیم کنارش نوشته شده است.
          </p>
        </div>
        <span
          className={
            mode === "live"
              ? "inline-flex items-center gap-1.5 rounded-full border border-teal-500/40 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700"
              : "inline-flex items-center gap-1.5 rounded-full border border-saffron-300/60 bg-saffron-50 px-3 py-1.5 text-xs font-medium text-saffron-600"
          }
        >
          <Radio className="size-3.5" aria-hidden="true" />
          {mode === "live" ? "حالت واقعی فعال" : "حالت نمونه (دادهٔ ساختگی)"}
        </span>
      </header>

      <section className="mt-5 grid gap-3 sm:grid-cols-2">
        {providers.map((provider) => (
          <div key={provider.id} className="card p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-ink-900">{provider.name}</h2>
              <span
                className={
                  provider.configured
                    ? "rounded-md bg-teal-50 px-1.5 py-0.5 text-[0.62rem] font-medium text-teal-700"
                    : "rounded-md bg-ink-100 px-1.5 py-0.5 text-[0.62rem] font-medium text-ink-500"
                }
              >
                {provider.configured ? "پیکربندی‌شده" : "پیکربندی نشده"}
              </span>
            </div>
            <p className="mt-1 text-[0.7rem] leading-5 text-ink-500">{provider.description}</p>
            <p className="mt-2 text-[0.62rem] leading-5 text-ink-400">
              <span className="font-medium text-ink-500">آنچه اعلام نمی‌شود: </span>
              {provider.missingFactsFa.join(" · ")}
            </p>
            <p className="mt-1.5 flex items-start gap-1 text-[0.62rem] leading-5 text-ink-400">
              <ShieldCheck className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              {provider.complianceNoteFa}
            </p>
          </div>
        ))}
      </section>

      <div className="mt-3 grid gap-2 text-[0.68rem] text-ink-500 sm:grid-cols-2">
        <p className="flex items-start gap-1.5 rounded-xl border border-ink-200 bg-white px-3 py-2">
          <Database className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {dbMode() === "postgres"
            ? "تاریخچهٔ قیمت روی PostgreSQL ثبت می‌شود."
            : "بدون DATABASE_URL تاریخچهٔ قیمت ثبت نمی‌شود؛ قیمت‌ها همچنان نمایش داده می‌شوند."}
        </p>
        <p className="flex items-start gap-1.5 rounded-xl border border-ink-200 bg-white px-3 py-2">
          <PlugZap className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          برای اجرای واقعی: <code className="font-mono">TOROB_SEARCH_MODE=live</code> و
          <code className="font-mono"> npm run search:live</code>
        </p>
      </div>

      <form className="card mt-5 grid gap-3 p-4 sm:grid-cols-[1fr_1fr_1fr_auto]" action="/live">
        <label className="text-xs font-medium text-ink-600">
          مبدأ
          <input
            name="origin"
            defaultValue={raw.origin ?? "THR"}
            className="input mt-1 w-full"
            placeholder="THR"
            maxLength={3}
            required
          />
        </label>
        <label className="text-xs font-medium text-ink-600">
          مقصد
          <input
            name="destination"
            defaultValue={raw.destination ?? "MHD"}
            className="input mt-1 w-full"
            placeholder="MHD"
            maxLength={3}
            required
          />
        </label>
        <label className="text-xs font-medium text-ink-600">
          تاریخ (میلادی)
          <input
            name="date"
            type="date"
            defaultValue={raw.date ?? addDays(isoToday(), 7)}
            className="input mt-1 w-full"
            required
          />
        </label>
        <input type="hidden" name="mode" value={mode} />
        <button type="submit" className="btn-primary self-end text-sm">
          جست‌وجو
        </button>
      </form>

      {!hasQuery ? (
        <p className="mt-6 rounded-xl border border-dashed border-ink-200 px-4 py-8 text-center text-sm text-ink-500">
          مسیر و تاریخ را انتخاب کنید تا قیمت‌های واقعی و وضعیت هر منبع را ببینید.
        </p>
      ) : !parsed || !parsed.ok ? (
        <div className="card mt-6 p-6 text-center">
          <AlertTriangle className="mx-auto size-5 text-saffron-600" aria-hidden="true" />
          <p className="mt-2 text-sm font-bold">{parsed && !parsed.ok ? parsed.reason : "پارامترهای جست‌وجو نامعتبر است"}</p>
        </div>
      ) : (
        <LiveResults parsedQuery={parsed.query} mode={mode} />
      )}

      <p className="mt-8 text-[0.65rem] leading-5 text-ink-400">
        این صفحه یک نمونهٔ مهندسی است و رزرو انجام نمی‌دهد. برای خرید، از لینک منبع استفاده کنید. قیمت‌ها ممکن
        است تا چند دقیقه پس از مشاهده تغییر کنند.
      </p>
      <Link href="/" className="mt-3 inline-flex items-center gap-1 text-xs text-teal-700 hover:underline">
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        بازگشت به نسخهٔ نمایشی
      </Link>
    </div>
  );
}

async function LiveResults({
  parsedQuery,
  mode,
}: {
  parsedQuery: Parameters<typeof runLiveSearch>[0];
  mode: "demo" | "live";
}) {
  const payload = await runLiveSearch(parsedQuery, { mode, sort: "best", persist: true });
  const origin = getCity(payload.query.originCity);
  const destination = getCity(payload.query.destinationCity);

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-ink-900">
          {origin?.fa ?? payload.query.originCity} → {destination?.fa ?? payload.query.destinationCity}
          <span className="mr-2 text-xs font-normal text-ink-500">{formatJalaliFull(payload.query.departDate)}</span>
        </h2>
        <p className="text-[0.68rem] text-ink-500">
          {toPersianDigits(payload.offers.length)} نتیجه در {toPersianDigits(payload.totalMs)} میلی‌ثانیه
        </p>
      </div>

      {payload.reports.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5 text-[0.62rem]">
          {payload.reports.map((report) => (
            <li
              key={report.providerId}
              className={
                report.ok
                  ? "rounded-md bg-teal-50 px-1.5 py-0.5 text-teal-700"
                  : "rounded-md bg-saffron-50 px-1.5 py-0.5 text-saffron-700"
              }
              title={report.error?.summaryFa ?? `${report.accepted} نرخ پذیرفته‌شده`}
            >
              {report.providerName}: {report.ok ? `${toPersianDigits(report.accepted)} نرخ` : report.error?.summaryFa ?? "خطا"}
            </li>
          ))}
        </ul>
      ) : null}

      {payload.persistence.reasonFa ? (
        <p className="mt-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-[0.65rem] text-ink-500">
          تاریخچه: {payload.persistence.reasonFa}
        </p>
      ) : null}

      {payload.offers.length === 0 ? (
        <div className="card mt-4 p-8 text-center">
          <h3 className="text-sm font-bold">نرخی برای این مسیر پیدا نشد</h3>
          <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-ink-500">
            {payload.mode === "demo"
              ? "در حالت نمونه فقط مسیرهای موجود در دادهٔ نمایشی نتیجه دارند. برای دادهٔ واقعی، حالت را به live تغییر دهید."
              : "هیچ منبعی برای این مسیر و تاریخ نرخی برنگرداند. این یعنی «موجود نیست»، نه اینکه خطایی رخ داده باشد."}
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {payload.offers.map((offer, index) => (
            <LiveOfferCard key={offer.id} offer={offer} index={index} />
          ))}
        </div>
      )}

      <Link
        href={`/live/history?origin=${payload.query.originCity}&destination=${payload.query.destinationCity}&date=${payload.query.departDate}`}
        className="btn-ghost mt-4 inline-flex text-xs"
      >
        تاریخچهٔ قیمت این مسیر
      </Link>
    </section>
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
