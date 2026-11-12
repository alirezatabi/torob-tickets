"use client";

import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { FilterPanel, type FilterPanelProps } from "./filter-sidebar";
import { toPersianDigits } from "@/lib/format";

/** Mobile: filters live in a bottom sheet; the same panel component is reused. */
export function MobileFilters(props: FilterPanelProps) {
  const [open, setOpen] = useState(false);
  const activeCount =
    (props.query.filters.maxStops !== null ? 1 : 0) +
    (props.query.filters.baggageRequired ? 1 : 0) +
    (props.query.filters.refundableOnly ? 1 : 0) +
    (props.query.filters.dayPart ? 1 : 0) +
    props.query.filters.preferredAirlines.length;

  return (
    <div className="lg:hidden">
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost text-xs">
        <SlidersHorizontal className="size-3.5" aria-hidden="true" />
        فیلترها
        {activeCount > 0 && (
          <span className="rounded-full bg-teal-600 px-1.5 text-[0.62rem] font-semibold text-white">
            {toPersianDigits(activeCount)}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-0 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="فیلترها"
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-ink-50 p-3 pb-6 shadow-2xl sm:rounded-2xl sm:pb-3"
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-sm font-bold">فیلترها</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-ink-500 hover:bg-white"
                aria-label="بستن فیلترها"
              >
                <X className="size-4" />
              </button>
            </div>
            <FilterPanel {...props} />
            <button type="button" onClick={() => setOpen(false)} className="btn-primary mt-3 w-full text-sm">
              نمایش نتایج
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
