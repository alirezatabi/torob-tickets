"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Clock, Sparkles, Wallet } from "lucide-react";
import { SORT_LABELS, type SortKey } from "@/ranking/score";
import { cn } from "@/lib/cn";

const ICONS: Record<SortKey, React.ReactNode> = {
  best: <Sparkles className="size-3.5" aria-hidden="true" />,
  cheapest: <Wallet className="size-3.5" aria-hidden="true" />,
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
    if (key === "best") params.delete("sort");
    else params.set("sort", key);
    startTransition(() => router.push(`/search?${params.toString()}`, { scroll: false }));
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-xl border border-ink-200 bg-white p-1",
        pending && "opacity-70",
      )}
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
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            current === key ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-50",
          )}
        >
          {ICONS[key]}
          {SORT_LABELS[key]}
        </button>
      ))}
    </div>
  );
}
