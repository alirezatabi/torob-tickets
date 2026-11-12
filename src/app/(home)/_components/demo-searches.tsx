import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { addDays, isoToday } from "@/lib/jalali";

/**
 * Ready-made searches. Plain links: the demo works with JS disabled and no API key,
 * and the label above each one is a date, not a sentence.
 */
export function DemoSearches() {
  const today = isoToday();
  const nextWeek = addDays(today, 7);
  const samples = [
    { title: "تهران ← استانبول", meta: "۴ منبع", href: `/search?origin=THR&destination=IST&date=${nextWeek}` },
    {
      title: "تهران ← استانبول",
      meta: "بار + مستقیم + ارزان",
      href: `/search?origin=THR&destination=IST&date=${nextWeek}&bag=1&stops=0&price=low`,
    },
    { title: "تهران ← دبی", meta: "۳ نرخ", href: `/search?origin=THR&destination=DXB&date=${addDays(today, 5)}` },
    { title: "تهران ← مشهد", meta: "داخلی", href: `/search?origin=THR&destination=MHD&date=${addDays(today, 3)}` },
  ];

  return (
    <section aria-labelledby="demo-searches" className="mt-5">
      <h2 id="demo-searches" className="mb-2 px-1 text-[0.68rem] font-medium text-ink-400">
        جستجوهای آماده
      </h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {samples.map((sample) => (
          <Link
            key={sample.href}
            href={sample.href}
            className="group flex items-center justify-between gap-2 rounded-xl border border-ink-200/80 bg-white/80 px-3 py-2.5 transition-colors hover:border-teal-400 hover:bg-white"
          >
            <span className="min-w-0">
              <span className="block truncate text-[0.78rem] font-semibold text-ink-800 group-hover:text-teal-800">
                {sample.title}
              </span>
              <span className="mt-0.5 block truncate text-[0.65rem] text-ink-400">{sample.meta}</span>
            </span>
            <ArrowLeft
              className="size-3 shrink-0 text-ink-300 transition-all group-hover:-translate-x-0.5 group-hover:text-teal-600"
              aria-hidden="true"
            />
          </Link>
        ))}
      </div>
    </section>
  );
}
