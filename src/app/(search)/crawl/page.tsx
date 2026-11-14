import Link from "next/link";
import { CRAWL_SOURCES, CRAWLER_PARSER_STATUS } from "@/crawler/sources";
import { getCrawlSnapshots } from "@/crawler/snapshot-provider";

export const dynamic = "force-dynamic";
export default async function CrawlPage() {
  const snapshots = await getCrawlSnapshots(CRAWL_SOURCES.map((source) => source.id));
  const bySource = new Map(snapshots.map((snapshot) => [snapshot.source, snapshot]));
  return <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6" dir="rtl">
    <Link href="/" className="text-sm text-teal-700 hover:underline">بازگشت به صفحهٔ اصلی</Link>
    <h1 className="mt-5 text-3xl font-black text-ink-900">وضعیت خزندهٔ محلی</h1>
    <p className="mt-3 max-w-2xl text-sm leading-7 text-ink-600">این صفحه فقط snapshotهای ذخیره‌شدهٔ محلی را می‌خواند و هیچ درخواست شبکه‌ای ایجاد نمی‌کند. اجرای خزش فقط با دستور CLI و فعال‌سازی صریح ممکن است. تا دریافت fixture عمومی واقعی، parserها عمداً پیاده‌سازی نشده‌اند.</p>
    <p className="mt-5 rounded-xl border border-saffron-300 bg-saffron-50 p-4 text-sm leading-6 text-saffron-800">{process.env.CRAWLER_ENABLED === "1" ? "خزش برای job محلی فعال است؛ این صفحه همچنان فقط فایل محلی می‌خواند." : "خزش خاموش است. برای اجرای دستی، CRAWLER_ENABLED=1 را فقط در محیط محلی تنظیم کنید."}</p>
    <div className="mt-6 space-y-3">{CRAWL_SOURCES.map((source) => {
      const snapshot = bySource.get(source.id);
      return <section key={source.id} className="rounded-2xl border border-ink-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="font-bold text-ink-900">{source.name}</h2><span className="rounded-full bg-saffron-50 px-3 py-1 text-xs text-saffron-700">{snapshot ? "snapshot محلی" : source.id === "safarmarket" ? "parser بر پایهٔ fixture" : "منتظر fixture واقعی"}</span></div>
        <p className="mt-2 text-xs leading-6 text-ink-500">parser: {CRAWLER_PARSER_STATUS[source.id]}</p>
        {snapshot && snapshot.source !== "synthetic-test" && <p className="mt-1 text-xs text-ink-600">{snapshot.offers.length} رکورد · مسیر {snapshot.route} · تاریخ {snapshot.date} · دریافت {snapshot.fetchedAt}</p>}
      </section>;
    })}</div>
    <pre dir="ltr" className="mt-6 overflow-x-auto rounded-xl bg-ink-900 p-4 text-xs leading-6 text-white">CRAWLER_ENABLED=1 npm run crawl:probe{"\n"}CRAWLER_ENABLED=1 npm run crawl:capture -- --source alibaba --route THR-MHD --date 2026-12-01</pre>
  </main>;
}
