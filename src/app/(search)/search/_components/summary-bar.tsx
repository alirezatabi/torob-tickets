import Link from "next/link";
import { ArrowLeft, CalendarDays, Pencil, Users } from "lucide-react";
import type { TripQuery } from "@/domain/trip";
import { CABIN_LABELS } from "@/domain/trip";
import { cityLabel } from "@/lib/cities";
import { formatJalaliFull } from "@/lib/jalali";
import { formatRelative, toPersianDigits } from "@/lib/format";

/** Sticky-ish context header: what exactly was searched, and a way to change it. */
export function SummaryBar({
  query,
  groupsCount,
  fetchedAt,
}: {
  query: TripQuery;
  groupsCount: number;
  fetchedAt: string;
}) {
  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 className="flex items-center gap-2 text-sm font-bold text-ink-900">
          <span>{cityLabel(query.originCode)}</span>
          <ArrowLeft className="size-4 text-teal-600" aria-hidden="true" />
          <span>{cityLabel(query.destinationCode)}</span>
        </h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-[0.7rem] text-ink-600">
          <CalendarDays className="size-3.5" aria-hidden="true" />
          {query.tripType === "roundtrip" && query.returnDate
            ? `${formatJalaliFull(query.departDate)} — ${formatJalaliFull(query.returnDate)}`
            : formatJalaliFull(query.departDate)}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-[0.7rem] text-ink-600">
          <Users className="size-3.5" aria-hidden="true" />
          {toPersianDigits(query.passengers)} مسافر · {CABIN_LABELS[query.cabin]}
        </span>
        <span className="text-[0.7rem] text-ink-400">
          {toPersianDigits(groupsCount)} گزینه · به‌روزرسانی {formatRelative(fetchedAt)}
        </span>
      </div>

      <Link
        href="/"
        className="btn-ghost text-[0.72rem]"
        aria-label="ویرایش جستجو"
        title="ویرایش جستجو"
      >
        <Pencil className="size-3.5" aria-hidden="true" />
        ویرایش جستجو
      </Link>
    </div>
  );
}
