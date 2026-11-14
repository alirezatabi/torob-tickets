import Link from "next/link";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { DateStripScroller } from "@/app/(search)/search/_components/date-strip-scroller";
import type { DayPrice } from "@/server/day-prices";
import { formatJalali } from "@/lib/jalali";
import { formatTomanCompact } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * The price strip above the results — a window of days you can **slide**, not a fixed 8-day block.
 *
 * Three things the previous version got wrong, and how this one behaves:
 *
 *   1. **The selected day is not pinned to the start.** The window is the selected day plus the
 *      following days, so tapping the 5th chip gives a URL whose window *begins* with the 5th…
 *      except for a day already behind it: when the user comes back with `date=` a few days old,
 *      the window starts at today, so «قبلی» can still reach the days before their pick and the
 *      neighbouring days stay visible. Paging is server-side (`offsets` on the pager, `date` on
 *      the chips), so every state is a real, shareable URL that works without JavaScript.
 *   2. **Days before the selection stay reachable.** «قبلی» slides the window back; it is never
 *      rendered before today, and the button disables itself (with the reason in `title`) once
 *      the window starts at today.
 *   3. **Swipe.** The list is a horizontal scroll-snap rail on narrow screens with the pager beside
 *      it; the CSS scroller is the swipe, no JS needed.
 *
 * A day without a price shows «—» and says why in its accessible name — never `۰`.
 */
export function DateStrip({
  prices,
  selectedDate,
  buildHref,
  pager,
}: {
  prices: DayPrice[];
  selectedDate: string;
  buildHref: (date: string) => string;
  /**
   * Sliding controls. `previousHref` is `null` at the earliest window (today); `nextHref` is
   * always available; `label` is the current window, e.g. «۲۲ تا ۲۹ آبان».
   */
  pager: {
    label: string;
    previousHref: string | null;
    nextHref: string | null;
    nextUnavailableReason?: string;
  };
}) {
  if (prices.length === 0) return null;

  return (
    <section aria-label="انتخاب روز پرواز" className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-3 py-2">
        <p className="inline-flex items-center gap-1.5 text-[0.68rem] font-semibold text-ink-600">
          <CalendarRange className="size-3.5 text-teal-600" aria-hidden="true" />
          ارزان‌ترین قیمت هر روز
          <span className="nums font-normal text-ink-400" data-testid="date-strip-range">
            {pager.label}
          </span>
        </p>

        <div className="flex items-center gap-1.5" role="group" aria-label="جابه‌جایی روزها">
          <span className="hidden text-[0.6rem] text-ink-400 sm:block">همین مسیر، همین تعداد مسافر</span>
          <PagerLink
            href={pager.previousHref}
            direction="previous"
            label="روزهای قبل"
            unavailableReason="از امروز عقب‌تر نمی‌شود؛ امروز اولین روز قابل خرید است."
          />
          <PagerLink
            href={pager.nextHref}
            direction="next"
            label="روزهای بعد"
            unavailableReason={pager.nextUnavailableReason}
          />
        </div>
      </div>

      <ol
        className="flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-2 py-2 [scrollbar-width:none] lg:grid lg:grid-cols-8 lg:overflow-visible"
        data-testid="date-strip"
        tabIndex={-1}
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

      {/* The rail is the swipe; the hint explains it without adding a control. */}
      <p className="flex items-center justify-center gap-1 border-t border-ink-100 px-3 py-1.5 text-[0.6rem] text-ink-400 lg:hidden">
        <ChevronRight className="size-3" aria-hidden="true" />
        برای دیدن روزهای بیشتر، نوار را بکشید
        <ChevronLeft className="size-3" aria-hidden="true" />
      </p>

      <DateStripScroller selectedDate={selectedDate} />
    </section>
  );
}

function PagerLink({
  href,
  direction,
  label,
  unavailableReason,
}: {
  href: string | null;
  direction: "previous" | "next";
  label: string;
  unavailableReason?: string;
}) {
  const Icon = direction === "previous" ? ChevronRight : ChevronLeft;
  const testId = direction === "previous" ? "date-strip-prev" : "date-strip-next";
  const className =
    "inline-flex size-7 items-center justify-center rounded-full border transition-colors";
  const icon = <Icon className="size-4" aria-hidden="true" />;

  if (!href) {
    return (
      <span
        aria-disabled="true"
        title={unavailableReason}
        className={cn(className, "cursor-not-allowed border-ink-100 text-ink-300")}
        data-testid={testId}
        data-disabled="true"
      >
        <span className="sr-only">{`${label} — ${unavailableReason}`}</span>
        {icon}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={cn(className, "border-ink-200 bg-white text-ink-600 hover:border-teal-400 hover:text-teal-700")}
      data-testid={testId}
      scroll={false}
    >
      {icon}
    </Link>
  );
}
