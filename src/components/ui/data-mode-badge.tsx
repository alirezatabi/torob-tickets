import Link from "next/link";
import { FlaskConical, Radio } from "lucide-react";

import { searchMode, type SearchMode } from "@/modules/providers/registry-live";

/**
 * The honesty affordance, now mode-aware.
 *
 * Demo mode keeps the original "داده‌های نمونه" badge. Live mode shows a distinct badge
 * that says *where* the numbers come from, because a user must never have to guess.
 */
export function DataModeBadge({ mode }: { mode?: SearchMode }) {
  const active = mode ?? searchMode();

  if (active === "live") {
    return (
      <Link
        href="/live"
        className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/40 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700"
        title="قیمت‌ها از منابع بیرونی خوانده می‌شوند و زمان مشاهدهٔ هر قیمت مشخص است."
      >
        <Radio className="size-3.5" aria-hidden="true" />
        دادهٔ واقعی
      </Link>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-saffron-300/60 bg-saffron-50 px-3 py-1.5 text-xs font-medium text-saffron-600"
      title="قیمت‌ها و پروازها داده‌های نمونهٔ ساختگی هستند و قیمت لحظه‌ای واقعی نیستند."
    >
      <FlaskConical className="size-3.5" aria-hidden="true" />
      داده‌های نمونه
    </span>
  );
}
