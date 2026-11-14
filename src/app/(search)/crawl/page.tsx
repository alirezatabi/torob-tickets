import Link from "next/link";
import { CRAWL_SOURCES } from "@/crawler/sources";
import { getCrawlSnapshots } from "@/crawler/snapshot-provider";
import type { CrawlSnapshot, RawOffer } from "@/crawler/types";

export const dynamic = "force-dynamic";

const persianNumber = new Intl.NumberFormat("fa-IR");
const iranDateTime = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  timeZone: "Asia/Tehran",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const iranDate = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  timeZone: "Asia/Tehran",
  year: "numeric",
  month: "long",
  day: "numeric",
});

export default async function CrawlPage() {
  const snapshots = await getCrawlSnapshots(CRAWL_SOURCES.map((source) => source.id));
  const sourceNames = new Map<string, string>(CRAWL_SOURCES.map((source) => [source.id, source.name]));

  return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" dir="rtl">
    <Link href="/" className="text-sm font-semibold text-teal-700 hover:underline">بازگشت به صفحهٔ اصلی</Link>
    <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-sm font-bold text-teal-700">داده‌های ذخیره‌شدهٔ خزنده</p>
        <h1 className="mt-1 text-3xl font-black text-ink-900 sm:text-4xl">پروازهای پیدا‌شده</h1>
      </div>
      <span className="rounded-full border border-ink-200 bg-white px-4 py-2 text-xs font-semibold text-ink-600">نمایش snapshot محلی · بدون درخواست شبکه</span>
    </div>
    <p className="mt-3 max-w-3xl text-sm leading-7 text-ink-600">
      این صفحه نرخ‌های ثبت‌شده در snapshot را نشان می‌دهد. برای Safarmarket واحد قیمت تومان و زمان پرواز منطقهٔ زمانی ایران است؛ اطلاعات در زمان اجرای آخرین job ذخیره شده و ممکن است تغییر کرده باشد.
    </p>
    {process.env.CRAWLER_ENABLED === "1" && <p className="mt-5 rounded-xl border border-saffron-300 bg-saffron-50 p-4 text-sm leading-6 text-saffron-800">فعال‌بودن متغیر خزش فقط برای job محلی است؛ بازکردن این صفحه هیچ crawlای اجرا نمی‌کند.</p>}

    {snapshots.length === 0 ? <section className="mt-8 rounded-3xl border border-dashed border-ink-300 bg-white p-8 text-center">
      <h2 className="text-lg font-bold text-ink-900">هنوز snapshot محلی پیدا نشد</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-ink-600">پس از اجرای crawl، همین صفحه فایل <code dir="ltr">data/crawl/latest.json</code> را می‌خواند. دادهٔ شبکه‌ای از این صفحه دریافت نمی‌شود.</p>
      <pre dir="ltr" className="mx-auto mt-5 max-w-2xl overflow-x-auto rounded-2xl bg-ink-900 p-4 text-left text-xs leading-6 text-white">$env:CRAWLER_ENABLED = &quot;1&quot;{"\n"}npm run crawl -- --source safarmarket --route THR-MHD --date 2026-11-22 --passengers 1</pre>
    </section> : <div className="mt-7 space-y-8">
      {snapshots.map((snapshot) => <SnapshotSection key={snapshot.source} snapshot={snapshot} sourceName={sourceNames.get(snapshot.source) ?? snapshot.source} />)}
    </div>}

    <p className="mt-8 text-xs leading-6 text-ink-500">داده‌ها جدا از پیشنهادهای نمایشی نگه‌داری می‌شوند. موجودی و قیمت فقط به‌اندازهٔ زمان ثبت snapshot معتبرند؛ صفحه برای تازه‌سازی خودکار درخواست نمی‌فرستد.</p>
  </main>;
}

function SnapshotSection({ snapshot, sourceName }: { snapshot: CrawlSnapshot; sourceName: string }) {
  const offers = [...snapshot.offers].sort((a, b) => (a.amount ?? Number.POSITIVE_INFINITY) - (b.amount ?? Number.POSITIVE_INFINITY));
  const date = parseIsoDate(snapshot.date);
  const fetched = parseInstant(snapshot.fetchedAt);

  return <section className="overflow-hidden rounded-3xl border border-ink-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-100 bg-ink-50/70 p-5 sm:p-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-black text-ink-900">{sourceName}</h2>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">snapshot ذخیره‌شده</span>
        </div>
        <p className="mt-2 text-sm text-ink-600">مسیر <b dir="ltr">{snapshot.route}</b> <span className="px-1">·</span> تاریخ پرواز {date ? iranDate.format(date) : snapshot.date}</p>
        <p className="mt-1 text-xs text-ink-500">آخرین دریافت: {fetched ? iranDateTime.format(fetched) : snapshot.fetchedAt} به وقت ایران</p>
      </div>
      <div className="rounded-2xl bg-white px-4 py-3 text-center shadow-sm ring-1 ring-ink-100">
        <div className="text-2xl font-black tabular-nums text-ink-900">{persianNumber.format(offers.length)}</div>
        <div className="mt-1 text-xs text-ink-500">نرخ ثبت‌شده</div>
      </div>
    </div>

    {offers.length === 0 ? <p className="p-6 text-sm text-ink-600">در این snapshot نرخی ثبت نشده است.</p> : <div className="max-h-[72vh] overflow-auto">
      <table className="min-w-[1050px] w-full border-collapse text-right text-sm">
        <thead className="sticky top-0 z-10 bg-white text-xs font-bold text-ink-500 shadow-sm">
          <tr>
            <th className="whitespace-nowrap px-4 py-3">پرواز / ایرلاین</th>
            <th className="whitespace-nowrap px-4 py-3">مبدأ</th>
            <th className="whitespace-nowrap px-4 py-3">مقصد</th>
            <th className="whitespace-nowrap px-4 py-3">حرکت · ایران</th>
            <th className="whitespace-nowrap px-4 py-3">رسیدن · ایران</th>
            <th className="whitespace-nowrap px-4 py-3">توقف</th>
            <th className="whitespace-nowrap px-4 py-3">ظرفیت</th>
            <th className="whitespace-nowrap px-4 py-3">فروشنده</th>
            <th className="whitespace-nowrap px-4 py-3">قیمت</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {offers.map((offer, index) => <OfferRow key={`${offer.id ?? snapshot.source}-${index}`} offer={offer} source={snapshot.source} />)}
        </tbody>
      </table>
    </div>}
  </section>;
}

function OfferRow({ offer, source }: { offer: RawOffer; source: string }) {
  const flightNo = readText(offer, "flightNumber");
  const airline = readText(offer, "airline");
  const airlineCode = readText(offer, "airlineCode");
  const departureLocal = localTime(offer, "departureLocal", "departAt");
  const arrivalLocal = localTime(offer, "arrivalLocal", "arriveAt");
  const provider = readText(offer, "providerName") ?? readText(offer, "providerId");
  const amount = offer.amount;
  const isToman = offer.currency === "IRT" || source === "safarmarket";
  const price = typeof amount === "number" && Number.isFinite(amount)
    ? `${persianNumber.format(Math.round(amount))} ${isToman ? "تومان" : readText(offer, "currency") ?? "واحد نامشخص"}`
    : "نامشخص";

  return <tr className="transition-colors hover:bg-teal-50/40">
    <td className="px-4 py-3">
      <div className="font-bold text-ink-900">{flightNo ?? "شماره نامشخص"}</div>
      <div className="mt-1 text-xs text-ink-500">{airline ?? airlineCode ?? "ایرلاین نامشخص"}</div>
    </td>
    <td dir="ltr" className="px-4 py-3 font-semibold text-ink-700">{readText(offer, "origin") ?? "—"}</td>
    <td dir="ltr" className="px-4 py-3 font-semibold text-ink-700">{readText(offer, "destination") ?? "—"}</td>
    <td className="whitespace-nowrap px-4 py-3 text-ink-700">{departureLocal}</td>
    <td className="whitespace-nowrap px-4 py-3 text-ink-700">{arrivalLocal}</td>
    <td className="px-4 py-3 text-ink-700">{readNumber(offer, "stopsCount") ?? "—"}</td>
    <td className="px-4 py-3 text-ink-700">{readNumber(offer, "seats") ?? "—"}</td>
    <td className="max-w-48 truncate px-4 py-3 text-ink-700" title={provider ?? undefined}>{provider ?? "—"}</td>
    <td className="whitespace-nowrap px-4 py-3 font-black tabular-nums text-teal-800">{price}</td>
  </tr>;
}

function readText(offer: RawOffer, key: string): string | null {
  const value = offer[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function readNumber(offer: RawOffer, key: string): number | null {
  const value = offer[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function localTime(offer: RawOffer, localKey: string, instantKey: "departAt" | "arriveAt"): string {
  const instant = offer[instantKey];
  if (typeof instant === "string" && Number.isFinite(Date.parse(instant))) return iranDateTime.format(new Date(instant));
  const local = readText(offer, localKey);
  return local ? local.replace("T", " ") : "—";
}
function parseInstant(value: string): Date | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}
