import { CircleAlert, CircleCheck, CircleSlash } from "lucide-react";
import type { ProviderHealth } from "@/providers/types";
import { toPersianDigits } from "@/lib/format";

/**
 * Transparency about the aggregation run: which providers answered, how many
 * records they returned, and how many were rejected. This is the "engineering"
 * beat of the demo, visible in the product itself.
 */
export function ProviderStrip({
  health,
  providersOk,
  issues,
}: {
  health: ProviderHealth[];
  providersOk: number;
  issues: number;
}) {
  const totalReturned = health.reduce((sum, item) => sum + item.returned, 0);

  return (
    <div className="rounded-xl border border-ink-200/70 bg-white/60 px-3.5 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="nums text-[0.68rem] text-ink-500">
          <span className="font-semibold text-ink-700">
            {toPersianDigits(providersOk)}/{toPersianDigits(health.length)}
          </span>{" "}
          منبع
          <span className="mx-1.5 text-ink-300">·</span>
          {toPersianDigits(totalReturned)} پیشنهاد خام
          {issues > 0 && (
            <>
              <span className="mx-1.5 text-ink-300">·</span>
              {toPersianDigits(issues)} نامعتبر
            </>
          )}
        </p>
        <span className="text-[0.6rem] text-ink-400">دادهٔ نمونه</span>
      </div>

      <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1.5">
        {health.map((item) => (
          <li key={item.id} className="inline-flex items-center gap-1.5 text-[0.65rem] text-ink-600">
            {item.ok ? (
              <CircleCheck className="size-3.5 text-teal-600" aria-hidden="true" />
            ) : (
              <CircleSlash className="size-3.5 text-berry-600" aria-hidden="true" />
            )}
            <span className="font-medium">{item.name}</span>
            <span className="text-ink-400">
              {item.ok ? `${toPersianDigits(item.returned)} مورد` : "خطا"}
              {item.rejected > 0 && ` · ${toPersianDigits(item.rejected)} نامعتبر`}
            </span>
            {item.quotedCurrency !== "IRT" && <span className="text-ink-400">({item.quotedCurrency})</span>}
          </li>
        ))}
      </ul>

      {health.some((item) => !item.ok) && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-[0.62rem] text-berry-600">
          <CircleAlert className="size-3" aria-hidden="true" />
          یک منبع پاسخ نداد
        </p>
      )}
    </div>
  );
}
