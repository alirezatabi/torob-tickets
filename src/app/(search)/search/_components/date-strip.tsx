import Link from "next/link";
import { CalendarRange } from "lucide-react";
import type { DayPrice } from "@/server/day-prices";
import { formatJalali } from "@/lib/jalali";
import { formatTomanCompact, toPersianDigits } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * The eight-day price strip above the results.
 *
 * Server-rendered links, not client state: each chip is a real URL with the selected `date`
 * replaced and **every other parameter kept** (passengers, cabin, filters, sort), so the strip
 * is shareable, works without JavaScript and is directly testable with Playwright.
 *
 * A day without a price shows «—» and says why in its accessible name — never `۰`.
 */
export function DateStrip({
  prices,
  selectedDate,
  buildHref,
}: {
  prices: DayPrice[];
  selectedDate: string;
  buildHref: (date: string) => string;
}) {
  if (prices.length === 0) return null;

  return (
    <section aria-label="انتخاب روز پرواز" className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-3 py-2">
        <p className="inline-flex items-center gap-1.5 text-[0.68rem] font-semibold text-ink-600">
          <CalendarRange className="size-3.5 text-teal-600" aria-hidden="true" />
          ارزان‌ترین قیمت هر روز — {toPersianDigits(prices.length)} روز پیشِ رو
        </p>
        <p className="hidden text-[0.6rem] text-ink-400 sm:block">همین مسیر، همین تعداد مسافر</p>
      </div>

      <ol
        className="flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-2 py-2 lg:grid lg:grid-cols-8 lg:overflow-visible"
        data-testid="date-strip"
      >
        {prices.map((day) => {
          const selected = day.date === selectedDate;
          const relative = day.isToday ? "امروز" : null;
          const priceText =
            day.cheapestToman === null ? "—" : formatTomanCompact(day.cheapestToman).replace(" تومان", "");
          const stateLabel =
            day.state === "error"
              ? "قیمت این روز دریافت نشد"
              : day.cheapestToman === null
                ? day.soldOutCount > 0
                  ? "برای این تعداد مسافر ظرفیت ندارد"
                  : "پروازی برای این روز نیست"
                : `ارزان‌ترین ${formatTomanCompact(day.cheapestToman)}`;
          return (
            <li key={day.date} className="min-w-[5.1rem] flex-1 snap-start">
              <Link
                href={buildHref(day.date)}
                aria-current={selected ? "date" : undefined}
                aria-label={`${day.label}${relative ? `، ${relative}` : ""}؛ ${stateLabel}`}
                data-testid="date-chip"
                data-date={day.date}
                data-selected={selected ? "true" : undefined}
                className={cn(
                  "flex h-full flex-col items-center gap-0.5 rounded-xl border px-2 py-2 text-center transition-colors",
                  selected
                    ? "border-teal-600 bg-teal-600 text-white shadow-sm"
                    : "border-ink-200 bg-white text-ink-700 hover:border-teal-300 hover:bg-teal-50/40",
                )}
              >
                <span className={cn("text-[0.6rem] font-medium", selected ? "text-teal-50" : "text-ink-400")}>
                  {relative ?? formatJalali(day.date, "weekday")}
                </span>
                <span className="text-[0.72rem] font-bold">{formatJalali(day.date, "short")}</span>
                <span
                  className={cn(
                    "nums text-[0.66rem] font-semibold",
                    day.cheapestToman === null ? (selected ? "text-teal-100" : "text-ink-300") : selected ? "text-white" : "text-ink-900",
                  )}
                  data-testid="date-chip-price"
                >
                  {priceText}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
