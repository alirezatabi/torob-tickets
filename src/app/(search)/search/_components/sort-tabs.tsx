"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarClock, Clock, Sparkles, Wallet } from "lucide-react";
import { SORT_LABELS, type SortKey } from "@/ranking/score";
import { DEFAULT_SORT } from "@/lib/search-params";
import { cn } from "@/lib/cn";

const ICONS: Record<SortKey, React.ReactNode> = {
  best: <Sparkles className="size-3.5" aria-hidden="true" />,
  cheapest: <Wallet className="size-3.5" aria-hidden="true" />,
  earliest: <CalendarClock className="size-3.5" aria-hidden="true" />,
  fastest: <Clock className="size-3.5" aria-hidden="true" />,
};

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
      {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
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
          {ICONS[key]}
          {SORT_LABELS[key]}
        </button>
      ))}
    </div>
  );
}
