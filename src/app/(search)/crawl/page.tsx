import Link from "next/link";
import { CRAWL_SOURCES } from "@/crawler/sources";
import { getCrawlSnapshots } from "@/crawler/snapshot-provider";
import { CrawledOffersBrowser } from "./_components/crawled-offers-browser";

export const dynamic = "force-dynamic";

export default async function CrawlPage() {
  const snapshots = await getCrawlSnapshots(CRAWL_SOURCES.map((source) => source.id));
  const sourceNames = new Map<string, string>(CRAWL_SOURCES.map((source) => [source.id, source.name]));

  return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" dir="rtl">
    <Link href="/" className="text-sm font-semibold text-teal-700 hover:underline">بازگشت به صفحهٔ اصلی</Link>
    <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-sm font-bold text-teal-700">جست‌وجو و مقایسهٔ snapshot</p>
        <h1 className="mt-1 text-3xl font-black text-ink-900 sm:text-4xl">بلیت‌های ثبت‌شده</h1>
      </div>
      <span className="rounded-full border border-ink-200 bg-white px-4 py-2 text-xs font-semibold text-ink-600">فیلتر محلی · بدون درخواست شبکه</span>
    </div>
    <p className="mt-3 max-w-3xl text-sm leading-7 text-ink-600">هر کد پرواز یک بلیت در نظر گرفته می‌شود؛ نرخ فروشنده‌های همان کد کنار هم می‌آیند. می‌توانید جست‌وجو، فیلتر و تا سه بلیت را مقایسه کنید. قیمت Safarmarket طبق فرض شما تومان و زمان‌ها به وقت ایران هستند.</p>
    {process.env.CRAWLER_ENABLED === "1" && <p className="mt-5 rounded-xl border border-saffron-300 bg-saffron-50 p-4 text-sm leading-6 text-saffron-800">فعال‌بودن متغیر خزش فقط برای job محلی است؛ بازکردن این صفحه هیچ crawlای اجرا نمی‌کند.</p>}

    {snapshots.length === 0 ? <section className="mt-8 rounded-3xl border border-dashed border-ink-300 bg-white p-8 text-center">
      <h2 className="text-lg font-bold text-ink-900">هنوز snapshot محلی پیدا نشد</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-ink-600">پس از اجرای crawl، همین صفحه فایل <code dir="ltr">data/crawl/latest.json</code> را می‌خواند. این صفحه خودش دادهٔ تازه دریافت نمی‌کند.</p>
      <pre dir="ltr" className="mx-auto mt-5 max-w-2xl overflow-x-auto rounded-2xl bg-ink-900 p-4 text-left text-xs leading-6 text-white">$env:CRAWLER_ENABLED = &quot;1&quot;{"\n"}npm run crawl -- --source safarmarket --route THR-MHD --date 2026-11-22 --passengers 1</pre>
    </section> : <div className="mt-7 space-y-8">
      {snapshots.map((snapshot) => <CrawledOffersBrowser key={snapshot.source} snapshot={snapshot} sourceName={sourceNames.get(snapshot.source) ?? snapshot.source} />)}
    </div>}

    <p className="mt-8 text-xs leading-6 text-ink-500">این snapshot از پیشنهادهای نمایشی جداست. قیمت و ظرفیت مربوط به زمان ثبت snapshot هستند؛ تازه‌سازی خودکار انجام نمی‌شود.</p>
  </main>;
}
