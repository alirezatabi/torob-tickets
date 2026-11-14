"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import type { OfferGroup } from "@/domain/flight";
import type { TripQuery } from "@/domain/trip";
import { airlineOptions, priceBounds, type DisplayFilters } from "@/lib/filter";
import { AirlineLogo } from "@/components/ui/airline-logo";
import { formatTomanCompact, toPersianDigits } from "@/lib/format";
import { cn } from "@/lib/cn";

const CHIP = "rounded-full px-2.5 py-1 text-[0.7rem] transition-colors";
const CHIP_ON = "bg-ink-900 font-semibold text-white";
const CHIP_OFF = "bg-ink-100 text-ink-600 hover:bg-ink-200/70";

const DAY_PARTS = [
  { key: "early-morning", label: "بامداد (۰۰–۰۶)" },
  { key: "morning", label: "صبح (۰۶–۱۲)" },
  { key: "afternoon", label: "بعدازظهر (۱۲–۱۷)" },
  { key: "evening", label: "عصر (۱۷–۲۱)" },
  { key: "night", label: "شب (۲۱–۲۴)" },
] as const;

export interface FilterPanelProps {
  query: TripQuery;
  groups: OfferGroup[];
  totalOffers: number;
}

/**
 * Filters live in the URL so results remain a pure function of the link.
 * The panel is shared by desktop (sidebar) and mobile (sheet).
 */
export function FilterSidebar(props: FilterPanelProps) {
  return <FilterPanel {...props} />;
}

export function FilterPanel({ query, groups, totalOffers }: FilterPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const bounds = useMemo(() => priceBounds(groups), [groups]);
  const airlines = useMemo(() => airlineOptions(groups), [groups]);

  const current: DisplayFilters = query.filters;
  const activeBag = current.baggageRequired;
  const activeRefund = current.refundableOnly;
  const activeStops = current.maxStops;
  const activeTime = current.dayPart;
  const activeAirlines = current.preferredAirlines;
  const activeDataSource = current.dataSource;

  const [priceCap, setPriceCap] = useState<number>(bounds.max);
  useEffect(() => setPriceCap(bounds.max), [bounds.max]);

  function apply(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    startTransition(() => router.push(`/search?${params.toString()}`, { scroll: false }));
  }

  function toggleAirline(code: string) {
    const next = activeAirlines.includes(code)
      ? activeAirlines.filter((item) => item !== code)
      : [...activeAirlines, code];
    apply({ airlines: next.length ? next.join(",") : null });
  }

  const activeCount =
    (activeStops !== null ? 1 : 0) +
    (activeBag ? 1 : 0) +
    (activeRefund ? 1 : 0) +
    (activeTime ? 1 : 0) +
    (activeDataSource !== "all" ? 1 : 0) +
    activeAirlines.length +
    (priceCap < bounds.max ? 1 : 0);

  return (
    <div className={cn("card p-4", pending && "opacity-70")}>
      <div className="flex items-center justify-between">
        <h2 className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-800">
          <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          فیلترها
          {activeCount > 0 && (
            <span className="rounded-full bg-teal-600 px-1.5 text-[0.62rem] font-semibold text-white">
              {toPersianDigits(activeCount)}
            </span>
          )}
        </h2>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => apply({ stops: null, bag: null, refund: null, time: null, airlines: null, price_max: null, source: null })}
            className="inline-flex items-center gap-1 text-[0.68rem] text-ink-400 hover:text-teal-700"
          >
            <RotateCcw className="size-3" aria-hidden="true" />
            پاک کردن
          </button>
        )}
      </div>
      <p className="mt-1 text-[0.65rem] text-ink-400">
        {toPersianDigits(totalOffers)} پیشنهاد از {toPersianDigits(groups.length)} پرواز
      </p>

      <FilterSection title="محدودهٔ قیمت">
        <input
          type="range"
          min={bounds.min}
          max={bounds.max}
          step={10_000}
          value={priceCap}
          onChange={(event) => setPriceCap(Number(event.target.value))}
          onMouseUp={() => apply({ price_max: priceCap < bounds.max ? String(priceCap) : null })}
          onTouchEnd={() => apply({ price_max: priceCap < bounds.max ? String(priceCap) : null })}
          onKeyUp={() => apply({ price_max: priceCap < bounds.max ? String(priceCap) : null })}
          aria-label="بیشترین قیمت"
          className="w-full accent-teal-600"
        />
        <div className="nums mt-1 flex items-center justify-between text-[0.65rem] text-ink-400">
          <span>{formatTomanCompact(bounds.min)}</span>
          <span className="font-semibold text-ink-700">{formatTomanCompact(priceCap)}</span>
        </div>
        <p className="mt-1 text-[0.62rem] text-ink-400">تومان · هر نفر</p>
      </FilterSection>

      <FilterSection title="نوع داده">
        <div className="flex flex-wrap gap-1.5">
          {[
            { value: "all", label: "همه" },
            { value: "demo", label: "نمونه" },
            { value: "real", label: "واقعی" },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => apply({ source: option.value === "all" ? null : option.value })}
              aria-pressed={activeDataSource === option.value}
              className={cn(CHIP, activeDataSource === option.value ? CHIP_ON : CHIP_OFF)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="تعداد توقف">
        <div className="flex flex-wrap gap-1.5">
          {[
            { value: null, label: "همه" },
            { value: "0", label: "مستقیم" },
            { value: "1", label: "حداکثر ۱" },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => apply({ stops: option.value })}
              aria-pressed={String(activeStops ?? "") === (option.value ?? "")}
              className={cn(
                CHIP,
                String(activeStops ?? "") === (option.value ?? "") ? CHIP_ON : CHIP_OFF,
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="بار و استرداد">
        <label className="flex cursor-pointer items-center justify-between text-[0.72rem] text-ink-700">
          <span>فقط با بار همراه</span>
          <input
            type="checkbox"
            checked={activeBag}
            onChange={() => apply({ bag: activeBag ? null : "1" })}
            className="size-4 accent-teal-600"
          />
        </label>
        <label className="mt-2 flex cursor-pointer items-center justify-between text-[0.72rem] text-ink-700">
          <span>فقط قابل استرداد</span>
          <input
            type="checkbox"
            checked={activeRefund}
            onChange={() => apply({ refund: activeRefund ? null : "1" })}
            className="size-4 accent-teal-600"
          />
        </label>
      </FilterSection>

      <FilterSection title="ساعت پرواز">
        <div className="flex flex-wrap gap-1.5">
          {DAY_PARTS.map((part) => (
            <button
              key={part.key}
              type="button"
              onClick={() => apply({ time: activeTime === part.key ? null : part.key })}
              aria-pressed={activeTime === part.key}
              className={cn(
                CHIP,
                activeTime === part.key ? CHIP_ON : CHIP_OFF,
              )}
            >
              {part.label}
            </button>
          ))}
        </div>
      </FilterSection>

      {airlines.length > 1 && (
        <FilterSection title="ایرلاین">
          <div className="space-y-1.5">
            {airlines.map((airline) => (
              <label
                key={airline.code}
                className="flex cursor-pointer items-center justify-between text-[0.72rem] text-ink-700"
              >
                <span className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={activeAirlines.includes(airline.code)}
                    onChange={() => toggleAirline(airline.code)}
                    className="size-3.5 accent-teal-600"
                  />
                  <AirlineLogo code={airline.code} name={airline.name} size={18} />
                  {airline.name}
                </span>
                <span className="text-[0.62rem] text-ink-400">{toPersianDigits(airline.count)}</span>
              </label>
            ))}
          </div>
        </FilterSection>
      )}
    </div>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 border-t border-ink-100 pt-3.5">
      <h3 className="mb-2 text-[0.7rem] font-bold uppercase tracking-wide text-ink-500">{title}</h3>
      {children}
    </section>
  );
}
