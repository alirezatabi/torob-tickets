import { FlaskConical } from "lucide-react";

/**
 * The honesty affordance, now the only one the product needs.
 *
 * This build has a single data source — the generated demo dataset — so the badge is a
 * constant statement rather than a mode switch. It must never be removed or reworded into
 * something that implies a real-time price.
 */
export function DataModeBadge({ dark = false }: { dark?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${dark ? "border-amber-300/25 bg-amber-200/[0.08] text-amber-200" : "border-saffron-300/60 bg-saffron-50 text-saffron-600"}`}
      title="قیمت‌ها و پروازها داده‌های نمونهٔ ساختگی هستند و قیمت لحظه‌ای واقعی نیستند."
    >
      <FlaskConical className="size-3.5" aria-hidden="true" />
      داده‌های نمونه
    </span>
  );
}
