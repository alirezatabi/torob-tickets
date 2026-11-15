import { Database } from "lucide-react";

/** The product searches only its local collection of real provider snapshots. */
export function DataModeBadge({ dark = false }: { dark?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${dark ? "border-sky-200/25 bg-sky-100/[0.08] text-sky-100" : "border-teal-300/60 bg-teal-50 text-teal-700"}`}
      title="فقط snapshotهای واقعی محلی؛ نه نرخ نمونه و نه تأیید موجودی زنده"
    >
      <Database className="size-3.5" aria-hidden="true" />
      snapshot محلی
    </span>
  );
}
