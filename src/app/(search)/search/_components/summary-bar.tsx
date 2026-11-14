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
    <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 className="flex items-center gap-2 text-[0.95rem] font-extrabold text-ink-900">
          <span>{cityLabel(query.originCode)}</span>
          <span className="grid size-6 place-items-center rounded-full bg-teal-50 text-teal-600">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
          </span>
          <span>{cityLabel(query.destinationCode)}</span>
        </h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-[0.7rem] font-medium text-ink-600">
          <CalendarDays className="size-3.5" aria-hidden="true" />
          {query.tripType === "roundtrip" && query.returnDate
            ? `${formatJalaliFull(query.departDate)} — ${formatJalaliFull(query.returnDate)}`
            : formatJalaliFull(query.departDate)}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-[0.7rem] font-medium text-ink-600">
          <Users className="size-3.5" aria-hidden="true" />
          {toPersianDigits(query.passengers)} مسافر · {CABIN_LABELS[query.cabin]}
        </span>
        <span className="nums text-[0.7rem] text-ink-400">
          {toPersianDigits(groupsCount)} گزینه
          <span className="mx-1.5 text-ink-300">·</span>
          {formatRelative(fetchedAt)}
        </span>
      </div>

      <Link href="/" className="btn-ghost text-[0.72rem]" aria-label="ویرایش جستجو" title="ویرایش جستجو">
        <Pencil className="size-3.5" aria-hidden="true" />
        ویرایش
      </Link>
    </div>
  );
}
