import Link from "next/link";

import { HISTORY_RANGE_LABELS_FA, type HistoryRange } from "@/modules/history/price-history";
import { cn } from "@/lib/cn";

/**
 * Range selector that preserves the current scope (route/flight/offer) in the URL, so a
 * chart always refers to the same offer identity while the window changes.
 */
export function RangeTabs({
  ranges,
  current,
  params,
}: {
  ranges: HistoryRange[];
  current: HistoryRange;
  params: Record<string, string>;
}) {
  const hrefFor = (range: HistoryRange) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === "range" || !value) continue;
      query.set(key, value);
    }
    query.set("range", range);
    return `/live/history?${query.toString()}`;
  };

  return (
    <nav className="flex flex-wrap gap-1" aria-label="بازهٔ زمانی">
      {ranges.map((range) => (
        <Link
          key={range}
          href={hrefFor(range)}
          aria-current={range === current ? "page" : undefined}
          className={cn(
            "rounded-full px-2.5 py-1 text-[0.68rem] font-medium transition-colors",
            range === current ? "bg-ink-900 text-white" : "text-ink-500 hover:bg-ink-100 hover:text-ink-900",
          )}
        >
          {HISTORY_RANGE_LABELS_FA[range]}
        </Link>
      ))}
    </nav>
  );
}
