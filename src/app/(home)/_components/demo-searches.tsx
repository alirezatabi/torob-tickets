import Link from "next/link";
import { ArrowLeft, Plane, Sparkles } from "lucide-react";
import { addDays, isoToday } from "@/lib/jalali";
import { toPersianDigits } from "@/lib/format";

/**
 * Ready-made searches. Plain links: the demo works with JS disabled and no API key,
 * and the label above each one is a date, not a sentence.
 */
export function DemoSearches() {
  const today = isoToday();
  const nextWeek = addDays(today, 7);
  const samples = [
    { from: "تهران", to: "استانبول", meta: "۴ منبع", href: `/search?origin=THR&destination=IST&date=${nextWeek}` },
    {
      from: "تهران",
      to: "استانبول",
      meta: "بار · مستقیم · ارزان",
      href: `/search?origin=THR&destination=IST&date=${nextWeek}&bag=1&stops=0&price=low`,
    },
    { from: "تهران", to: "دبی", meta: "۳ نرخ", href: `/search?origin=THR&destination=DXB&date=${addDays(today, 5)}` },
    { from: "تهران", to: "مشهد", meta: "داخلی", href: `/search?origin=THR&destination=MHD&date=${addDays(today, 3)}` },
  ];

  return (
    <section
      aria-labelledby="demo-searches"
      className="relative mt-4 overflow-hidden rounded-[1.75rem] border border-white/90 bg-white/80 p-4 shadow-[0_18px_50px_-36px_rgba(15,35,55,0.28)] backdrop-blur-xl sm:mt-0 sm:p-5 lg:p-6"
    >
      <div aria-hidden="true" className="pointer-events-none absolute -left-12 -top-20 size-48 rounded-full bg-teal-100/50 blur-3xl" />
      <header className="relative mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-teal-50 text-teal-700 ring-1 ring-teal-100">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[0.62rem] font-bold tracking-wide text-teal-700">جست‌وجوی سریع</p>
            <h2 id="demo-searches" className="mt-0.5 text-sm font-extrabold text-ink-900 sm:text-base">
              از یک مسیر آماده شروع کنید
            </h2>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-200/80 bg-white/80 px-3 py-1.5 text-[0.65rem] font-medium text-ink-500">
          <Plane className="size-3 text-teal-600" aria-hidden="true" />
          ۴ پیشنهاد برای شروع
        </span>
      </header>

      <div className="relative grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {samples.map((sample, index) => (
          <Link
            key={sample.href}
            href={sample.href}
            className="group flex min-h-[5.2rem] items-center justify-between gap-2.5 rounded-2xl border border-ink-200/75 bg-white/80 px-3 py-3 transition-[transform,border-color,box-shadow,background-color] duration-200 hover:-translate-y-0.5 hover:border-teal-300 hover:bg-white hover:shadow-[0_14px_28px_-22px_rgba(13,107,96,0.48)] focus-visible:outline-teal-600"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-ink-50 text-[0.65rem] font-bold text-ink-500 transition-colors group-hover:bg-teal-50 group-hover:text-teal-700">
                {toPersianDigits(index + 1)}
              </span>
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-1 text-[0.76rem] font-bold text-ink-800 group-hover:text-teal-800">
                  <span className="truncate">{sample.from}</span>
                  <ArrowLeft className="size-3 shrink-0 text-ink-300 group-hover:text-teal-500" aria-hidden="true" />
                  <span className="truncate">{sample.to}</span>
                </span>
                <span className="mt-1.5 block truncate text-[0.63rem] text-ink-400">{sample.meta}</span>
              </span>
            </span>
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink-50 text-ink-400 transition-all group-hover:-translate-x-0.5 group-hover:bg-teal-600 group-hover:text-white">
              <ArrowLeft className="size-3" aria-hidden="true" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
