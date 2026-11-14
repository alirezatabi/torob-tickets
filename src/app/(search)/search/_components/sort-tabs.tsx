"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarClock, Clock, Wallet } from "lucide-react";
import type { SortKey } from "@/ranking/score";
import { DEFAULT_SORT } from "@/lib/search-params";
import { cn } from "@/lib/cn";

/**
 * The tabs the results page offers. «بهترین تطابق» is deliberately absent: the page no longer
 * recommends a winner, it lets the user pick one — a tab called "best match" would be the same
 * judgement in another place. The `best` sort key still exists server-side (the compare page
 * and the explanation API use it as a ranking order), it is simply not a user-facing choice.
 */
const TABS: { key: SortKey; label: string; icon: React.ReactNode }[] = [
  { key: "cheapest", label: "ارزان‌ترین", icon: <Wallet className="size-3.5" aria-hidden="true" /> },
  { key: "fastest", label: "سریع‌ترین", icon: <Clock className="size-3.5" aria-hidden="true" /> },
  { key: "earliest", label: "زودترین حرکت", icon: <CalendarClock className="size-3.5" aria-hidden="true" /> },
];

/**
 * Sorting is a URL change, not local state: results stay server-rendered and the
 * link is shareable (and Playwright-testable without JS semantics).
 */
export function SortTabs({ current }: { current: SortKey }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function select(key: SortKey) {
    const params = new URLSearchParams(searchParams.toString());
    // The URL is the state: no `sort` means the default (cheapest), which keeps links short.
    if (key === DEFAULT_SORT) params.delete("sort");
    else params.set("sort", key);
    startTransition(() => router.push(`/search?${params.toString()}`, { scroll: false }));
  }

  return (
    <div
      className={cn("segmented", pending && "opacity-70")}
      role="tablist"
      aria-label="مرتب‌سازی نتایج"
    >
      {TABS.map(({ key, label, icon }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={current === key}
          onClick={() => select(key)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all",
            current === key
              ? "bg-white text-ink-900 shadow-[0_1px_2px_rgba(15,23,42,0.10)]"
              : "text-ink-500 hover:text-ink-800",
          )}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  );
}
