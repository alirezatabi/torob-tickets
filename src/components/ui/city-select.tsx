"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, Search } from "lucide-react";
import { CITIES } from "@/lib/cities";
import { cn } from "@/lib/cn";
import { useFloatingPanel } from "@/hooks/use-floating-panel";

/**
 * Searchable city combobox with Persian + English matching.
 * A plain <select> over 15 airports would be usable, but typing "استان" should work.
 */
export function CitySelect({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelPosition = useFloatingPanel(open, buttonRef, { preferredWidth: 288, minWidth: 256, preferredHeight: 360 });

  const selected = CITIES.find((c) => c.code === value);
  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return CITIES;
    return CITIES.filter((city) =>
      [city.fa, city.en, city.code, ...city.aliases].some((alias) => alias.toLowerCase().includes(needle)),
    );
  }, [term]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onClick={() => {
          setOpen((v) => !v);
          setTerm("");
        }}
        className="field flex items-center justify-between gap-2 text-right"
      >
        <span className={cn("flex flex-col items-start", !selected && "text-ink-400")}>
          <span className="text-[0.925rem] font-medium">{selected ? selected.fa : placeholder ?? "انتخاب کنید"}</span>
          {selected && <span className="text-[0.7rem] text-ink-400">{selected.airportFa}</span>}
        </span>
        <Search className="size-4 shrink-0 text-ink-400" aria-hidden="true" />
      </button>

      {open && panelPosition && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          style={{
            position: panelPosition.position,
            top: panelPosition.top,
            left: panelPosition.left,
            width: panelPosition.width,
            maxHeight: panelPosition.maxHeight,
          }}
          className="z-[10000] overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-[var(--shadow-lifted)] animate-rise"
        >
          <div className="border-b border-ink-100 p-2">
            <input
              autoFocus
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="جستجوی شهر…"
              className="w-full rounded-lg bg-ink-50 px-3 py-2 text-sm outline-none placeholder:text-ink-400"
              aria-label="جستجوی شهر"
            />
          </div>
          <ul
            id={`${id}-listbox`}
            role="listbox"
            style={{ maxHeight: Math.max(48, panelPosition.maxHeight - 58) }}
            className="overflow-auto p-1"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-ink-400">شهری با این نام پیدا نشد.</li>
            )}
            {filtered.map((city) => (
              <li key={city.code} role="option" aria-selected={city.code === value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(city.code);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-right text-sm hover:bg-ink-50",
                    city.code === value && "bg-teal-50",
                  )}
                >
                  <span className="flex flex-col">
                    <span className="font-medium text-ink-800">{city.fa}</span>
                    <span className="text-[0.7rem] text-ink-400">{city.airportFa}</span>
                  </span>
                  <span dir="ltr" className="rounded bg-ink-50 px-1.5 py-0.5 text-[0.65rem] font-semibold text-ink-500">
                    {city.code}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}

export function SwapButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid size-10 place-items-center self-end rounded-full border border-ink-200 bg-white text-ink-500 shadow-sm transition-colors hover:border-teal-400 hover:text-teal-600"
      aria-label="جابه‌جایی مبدأ و مقصد"
      title="جابه‌جایی مبدأ و مقصد"
    >
      <ArrowLeftRight className="size-4" aria-hidden="true" />
    </button>
  );
}
