import Link from "next/link";
import { CalendarDays, Sparkles } from "lucide-react";
import { addDays, isoToday } from "@/lib/jalali";
import { formatJalali } from "@/lib/jalali";

/**
 * Curated demo entry points. They are plain links, so the whole demo works with
 * JS disabled and no API key — critical for a 5-minute live presentation.
 */
export function DemoSearches() {
  const today = isoToday();
  const nextWeek = addDays(today, 7);
  const samples = [
    {
      title: "تهران → استانبول",
      subtitle: "همهٔ ۴ ارائه‌دهنده، مسیر اصلی دمو",
      href: `/search?origin=THR&destination=IST&date=${nextWeek}`,
      accent: "teal" as const,
    },
    {
      title: "تهران → استانبول، ارزان و با بار",
      subtitle: "مستقیم، با بار، ارزان‌ترین",
      href: `/search?origin=THR&destination=IST&date=${nextWeek}&bag=1&stops=0&price=low`,
      accent: "saffron" as const,
    },
    {
      title: "تهران → دبی",
      subtitle: "مقایسهٔ سه نرخ در یک روز",
      href: `/search?origin=THR&destination=DXB&date=${addDays(today, 5)}`,
      accent: "teal" as const,
    },
    {
      title: "تهران → مشهد",
      subtitle: "پرواز داخلی",
      href: `/search?origin=THR&destination=MHD&date=${addDays(today, 3)}`,
      accent: "ink" as const,
    },
  ];

  return (
    <section aria-labelledby="demo-searches" className="mt-6">
      <div className="mb-2.5 flex items-center gap-2">
        <h2 id="demo-searches" className="text-xs font-semibold text-ink-500">
          جستجوهای آمادهٔ نمایش
        </h2>
        <span className="text-[0.68rem] text-ink-400">— {formatJalali(nextWeek, "long")} به بعد</span>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {samples.map((sample) => (
          <Link
            key={sample.href}
            href={sample.href}
            className="group flex items-start gap-2.5 rounded-xl border border-ink-200 bg-white px-3 py-2.5 transition-all hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-[var(--shadow-soft)]"
          >
            <span
              className={
                sample.accent === "saffron"
                  ? "mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-saffron-50 text-saffron-600"
                  : sample.accent === "teal"
                    ? "mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-600"
                    : "mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-ink-100 text-ink-600"
              }
            >
              {sample.accent === "saffron" ? (
                <Sparkles className="size-3.5" aria-hidden="true" />
              ) : (
                <CalendarDays className="size-3.5" aria-hidden="true" />
              )}
            </span>
            <span className="flex flex-col">
              <span className="text-xs font-semibold text-ink-800 group-hover:text-teal-700">{sample.title}</span>
              <span className="mt-0.5 text-[0.68rem] leading-4 text-ink-400">{sample.subtitle}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
