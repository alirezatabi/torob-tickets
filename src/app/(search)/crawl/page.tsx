import Link from "next/link";
import { CRAWL_SOURCES, CRAWLER_PARSER_STATUS } from "@/crawler/sources";
import { getCrawlSnapshots } from "@/crawler/snapshot-provider";
import { readCrawlWorkerStatus } from "@/crawler/worker-status";
import { toPersianDigits } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CrawlPage() {
  const [snapshots, worker] = await Promise.all([
    getCrawlSnapshots(CRAWL_SOURCES.map((source) => source.id)),
    readCrawlWorkerStatus(),
  ]);
  const bySource = new Map<string, typeof snapshots>();
  for (const snapshot of snapshots) {
    const list = bySource.get(snapshot.source) ?? [];
    list.push(snapshot);
    bySource.set(snapshot.source, list);
  }

  return <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6" dir="rtl">
    <Link href="/" className="text-sm text-teal-700 hover:underline">بازگشت به صفحهٔ اصلی</Link>
    <h1 className="mt-5 text-3xl font-black text-ink-900">وضعیت خزندهٔ محلی</h1>
    <p className="mt-3 max-w-2xl text-sm leading-7 text-ink-600">این صفحه فقط وضعیت worker و snapshotهای محلی را می‌خواند؛ هیچ درخواست شبکه‌ای یا crawlای با بازکردن آن آغاز نمی‌شود. بلیت‌ها در جست‌وجوی اصلی دیده می‌شوند.</p>

    <section className="mt-5 rounded-xl border border-ink-200 bg-white p-4 text-sm">
      <h2 className="font-bold text-ink-900">Worker دوره‌ای</h2>
      <p className="mt-2 text-ink-600">{worker?.state === "running" ? "در حال اجرا" : "وضعیت زنده در دسترس نیست"}{worker?.heartbeatAt ? ` · آخرین heartbeat ${worker.heartbeatAt}` : ""}</p>
      {worker?.lastCycleAt && <p className="mt-1 text-xs text-ink-500">آخرین چرخه: {worker.lastCycleAt} · {toPersianDigits(worker.lastCycle?.snapshotsWritten ?? 0)} snapshot ذخیره شد · {toPersianDigits(worker.lastCycle?.observationsWritten ?? 0)} نقطهٔ قیمت ثبت شد</p>}
      {worker?.lastError && <p className="mt-1 text-xs text-danger-600">آخرین خطا: {worker.lastError}</p>}
      {!worker && <p className="mt-1 text-xs leading-5 text-ink-500">برای راه‌اندازی دائم، دستورهای systemd در <code dir="ltr">deploy/torob-crawler.service</code> و راهنمای <code>docs/CRAWLER.md</code> را ببینید.</p>}
    </section>

    <p className="mt-4 rounded-xl border border-saffron-300 bg-saffron-50 p-4 text-sm leading-6 text-saffron-800">{process.env.CRAWLER_ENABLED === "1" ? "خزش فقط در worker محلی/میزبانِ مجاز با تنظیم صریح فعال می‌شود؛ این صفحه همچنان صرفاً وضعیت را می‌خواند." : "خزش خاموش است. اجرای worker نیازمند CRAWLER_ENABLED=1، رضایت به robots.txt و PostgreSQL برای تاریخچه است."}</p>

    <div className="mt-6 space-y-3">{CRAWL_SOURCES.map((source) => {
      const sourceSnapshots = bySource.get(source.id) ?? [];
      const latest = [...sourceSnapshots].sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))[0];
      return <section key={source.id} className="rounded-2xl border border-ink-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="font-bold text-ink-900">{source.name}</h2><span className="rounded-full bg-saffron-50 px-3 py-1 text-xs text-saffron-700">{sourceSnapshots.length ? `${toPersianDigits(sourceSnapshots.length)} مسیر/تاریخ ذخیره‌شده` : source.id === "safarmarket" ? "آماده؛ در انتظار snapshot" : "منتظر fixture واقعی"}</span></div>
        <p className="mt-2 text-xs leading-6 text-ink-500">وضعیت parser: {CRAWLER_PARSER_STATUS[source.id]}</p>
        {latest && <p className="mt-1 text-xs text-ink-600">آخرین snapshot: {latest.offers.length} نرخ خام · مسیر {latest.route} · تاریخ پرواز {latest.date} · دریافت {latest.fetchedAt}</p>}
      </section>;
    })}</div>
  </main>;
}
