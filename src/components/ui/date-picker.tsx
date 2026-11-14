"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  formatJalaliFull,
  isoToJalali,
  jalaliMonthLength,
  jalaliMonthStartWeekday,
  jalaliToIso,
  persianMonthLabel,
  toIsoDate,
  isoToday,
} from "@/lib/jalali";
import { toPersianDigits } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useFloatingPanel } from "@/hooks/use-floating-panel";

const WEEKDAY_HEADERS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

/**
 * A Jalali date picker.
 *
 * Deliberately hand-built: native date inputs show the Gregorian calendar, which
 * would break the Persian-first experience. Values are exchanged as ISO civil dates.
 */
export function DatePicker({
  value,
  onChange,
  min,
  label,
  id,
}: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  label: string;
  id: string;
}) {
  const [open, setOpen] = useState(false);
  const [viewJalali, setViewJalali] = useState(() => isoToJalali(value || isoToday()));
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelPosition = useFloatingPanel(open, buttonRef, { preferredWidth: 304, preferredHeight: 376 });
  const today = useMemo(() => isoToday(), []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (value) setViewJalali(isoToJalali(value));
  }, [value]);

  const daysInMonth = jalaliMonthLength(viewJalali.year, viewJalali.month);
  const startWeekday = (jalaliMonthStartWeekday(viewJalali.year, viewJalali.month) + 1) % 7; // Saturday-first
  const cells: (number | null)[] = [
    ...Array.from({ length: startWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function shiftMonth(delta: number) {
    setViewJalali((current) => {
      const month = current.month + delta;
      if (month < 1) return { year: current.year - 1, month: 12, day: 1 };
      if (month > 12) return { year: current.year + 1, month: 1, day: 1 };
      return { ...current, month };
    });
  }

  const selectedIso = value;

  return (
    <div className="relative" ref={containerRef}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="field flex items-center justify-between gap-2 text-right"
      >
        <span className={cn("truncate", !value && "text-ink-400")}>
          {value ? formatJalaliFull(value) : "انتخاب تاریخ"}
        </span>
        <CalendarDays className="size-4 shrink-0 text-ink-400" aria-hidden="true" />
      </button>

      {open && panelPosition && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="تقویم شمسی"
          style={{
            position: panelPosition.position,
            top: panelPosition.top,
            left: panelPosition.left,
            width: panelPosition.width,
            maxHeight: panelPosition.maxHeight,
          }}
          className="z-[10000] overflow-auto rounded-2xl border border-ink-200 bg-white p-3 shadow-[var(--shadow-lifted)] animate-rise"
        >
          <div className="flex items-center justify-between px-1 pb-2">
            <button
              type="button"
              className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-50"
              onClick={() => shiftMonth(-1)}
              aria-label="ماه قبل"
            >
              <ChevronRight className="size-4" />
            </button>
            <span className="text-sm font-semibold">{persianMonthLabel(viewJalali.year, viewJalali.month)}</span>
            <button
              type="button"
              className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-50"
              onClick={() => shiftMonth(1)}
              aria-label="ماه بعد"
            >
              <ChevronLeft className="size-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[0.68rem] font-medium text-ink-400">
            {WEEKDAY_HEADERS.map((day) => (
              <span key={day} className="py-1">
                {day}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, index) => {
              if (day === null) return <span key={`empty-${index}`} />;
              const iso = jalaliToIso(viewJalali.year, viewJalali.month, day);
              const disabled = min ? iso < min : false;
              const isSelected = iso === selectedIso;
              const isToday = iso === today;
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex h-9 items-center justify-center rounded-lg text-sm transition-colors",
                    isSelected
                      ? "bg-teal-600 font-semibold text-white"
                      : isToday
                        ? "border border-teal-500/40 text-teal-700 hover:bg-teal-50"
                        : "text-ink-700 hover:bg-ink-50",
                    disabled && "cursor-not-allowed text-ink-300 hover:bg-transparent",
                  )}
                  aria-label={toIsoDate(viewJalali.year, viewJalali.month, day)}
                  aria-pressed={isSelected}
                >
                  {toPersianDigits(day)}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-ink-100 pt-2">
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50"
              onClick={() => {
                onChange(today);
                setOpen(false);
              }}
            >
              امروز
            </button>
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50"
              onClick={() => {
                onChange(addDaysLocal(today, 1));
                setOpen(false);
              }}
            >
              فردا
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function addDaysLocal(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}
