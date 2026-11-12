import { FlaskConical } from "lucide-react";

/**
 * Honesty affordance required by the brief: nothing in this app may be presented
 * as a live, real-time price.
 */
export function DemoBadge({ variant = "badge" }: { variant?: "badge" | "inline" }) {
  if (variant === "inline") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-saffron-50 px-1.5 py-0.5 text-[0.65rem] font-medium text-saffron-600">
        <FlaskConical className="size-3" aria-hidden="true" />
        دادهٔ نمونه
      </span>
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
