import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, ArrowRight, CalendarDays, SearchX } from "lucide-react";
import { DEFAULT_SORT, parseSearchParams, searchHref, SORT_KEYS, type SortKeyParam } from "@/lib/search-params";
import { addDays, isoToday } from "@/lib/jalali";
import { cityLabel } from "@/lib/cities";
import { toPersianDigits } from "@/lib/format";
import { searchTrips } from "@/server/search-service";
import {
  clampIntoWindow,
  DATE_STRIP_DAYS,
  getDayPrices,
  nextStripStart,
  previousStripStart,
  resolveStripStart,
  stripRangeLabel,
} from "@/server/day-prices";
import { recordSearch } from "@/server/persistence";
import { ResultsList } from "@/app/(search)/search/_components/results-list";
import { FilterSidebar } from "@/app/(search)/search/_components/filter-sidebar";
import { SortTabs } from "@/app/(search)/search/_components/sort-tabs";
import { SummaryBar } from "@/app/(search)/search/_components/summary-bar";
import { ResultsSkeleton } from "@/app/(search)/search/_components/results-skeleton";
import { MobileFilters } from "@/app/(search)/search/_components/mobile-filters";
import { DateStrip } from "@/app/(search)/search/_components/date-strip";

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const params = flatten(await searchParams);
  if (!params.origin || !params.destination) return { title: "جستجوی پرواز" };
  return {
    title: `قیمت پرواز ${cityLabel(params.origin)} به ${cityLabel(params.destination)}`,
    description: "هر پرواز یک ردیف کوتاه: ساعت، ارزان‌ترین قیمت، ظرفیت، مسیر، ایرلاین و نوع هواپیما.",
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const raw = flatten(await searchParams);
  // Origin + destination is all the product needs: no date means "today in Tehran" (B1).
  const parsed = parseSearchParams(raw);

  if (!parsed.ok) {
    return <SearchProblem reason={parsed.reason} missing={parsed.missing} invalidDate={parsed.invalid === "date"} />;
  }

  // Only the three tabs exist now; a bookmarked `sort=best` link degrades to the default
  // instead of silently ordering by a mode no tab can show.
  const sortParam: SortKeyParam =
    (SORT_KEYS as readonly string[]).includes(raw.sort ?? "") && raw.sort !== "best"
      ? (raw.sort as SortKeyParam)
      : DEFAULT_SORT;
  const query = parsed.query;
  const view = await searchTrips(query, sortParam);
  const { outcome, flights } = view;

  // Audit trail (B22). It is awaited — a floating promise can be cancelled the moment the
  // response is sent, which silently loses rows on serverless — but it can never break or
  // meaningfully delay the page: no DATABASE_URL is a no-op, and any error is swallowed.
  if (process.env.DATABASE_URL) {
    try {
      await recordSearch(outcome, view.results.rankedView);
    } catch {
      // Auditing is never allowed to take the results down with it.
    }
  }

  const providersOk = outcome.health.filter((health) => health.ok).length;
  const hasSampleData = outcome.offers.some((offer) => offer.dataSource === "demo");
  const hasRealData = outcome.offers.some((offer) => offer.dataSource === "live" || offer.dataSource === "crawled");
  const hasLocalSnapshot = (outcome.rawCounts.safarmarket ?? 0) > 0;
  const sourceLabel = query.filters.dataSource === "demo"
    ? "فقط دادهٔ نمونه"
    : query.filters.dataSource === "real"
      ? hasRealData ? "فقط دادهٔ واقعی" : hasLocalSnapshot ? "snapshot موجود · نرخ قابل نمایش نیست" : "دادهٔ واقعی · snapshotی برای این مسیر/تاریخ نیست"
      : hasSampleData && hasRealData ? "دادهٔ نمونه و واقعی"
        : hasRealData ? "دادهٔ واقعی" : "دادهٔ نمونه";
  const hasResults = flights.length > 0;
  // The strip's position travels in `?strip=`, so tapping a chip does not re-anchor the strip
  // (`resolveStripStart` rejects a start that would hide the selected day or point into the past).
  const today = isoToday();
  const stripStart = resolveStripStart(
    typeof raw.strip === "string" ? raw.strip : null,
    query.departDate,
    today,
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <SummaryBar query={query} groupsCount={flights.length} fetchedAt={outcome.fetchedAt} />

      <div className="mt-3">
        <Suspense fallback={<DateStripSkeleton />}>
          <DateStripSection
            query={query}
            sort={sortParam}
            selectedDate={query.departDate}
            stripStart={stripStart}
            today={today}
          />
        </Suspense>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[17rem_1fr] lg:items-start">
        <aside className="hidden lg:sticky lg:top-20 lg:block">
          <div className="max-h-[calc(100vh-6rem)] overflow-y-auto rounded-[var(--radius-card)] pb-2 pr-0.5">
            <FilterSidebar query={query} groups={view.groups} totalOffers={outcome.offers.length} />
          </div>
        </aside>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SortTabs current={sortParam} />
            <MobileFilters query={query} groups={view.groups} totalOffers={outcome.offers.length} />
          </div>

          <div className="mt-3 space-y-3">
            {hasResults ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="nums text-[0.7rem] text-ink-500">
                    <span className="font-semibold text-ink-700">{toPersianDigits(flights.length)} پرواز</span>
                    {outcome.offers.length > 0 && (
                      <>
                        <span className="mx-1.5 text-ink-300">·</span>
                        {toPersianDigits(outcome.offers.length)} نرخ از {toPersianDigits(providersOk)} منبع
                      </>
                    )}
                    <span className="mx-1.5 text-ink-300">·</span>
                    ارزان‌ترین اول
                  </p>
                  <p className="text-[0.62rem] text-ink-400" title={hasRealData ? "دادهٔ واقعی از snapshot محلی است و موجودی یا تازه‌بودن آن در این صفحه دوباره تأیید نمی‌شود." : "این نتایج از دادهٔ نمونهٔ درون‌برنامه هستند."}>
                    {sourceLabel}
                  </p>
                </div>

                <Suspense fallback={<ResultsSkeleton />}>
                  <ResultsList query={query} flights={flights} />
                </Suspense>

                {outcome.issues.length > 0 && (
                  <p className="rounded-xl border border-ink-200 bg-white px-4 py-3 text-[0.7rem] leading-5 text-ink-500">
                    {toPersianDigits(outcome.issues.length)} رکورد به‌دلیل دادهٔ ناقص یا نامعتبر نمایش داده نشد.
                  </p>
                )}
              </>
            ) : (
              <EmptyState query={query} hasLocalSnapshot={hasLocalSnapshot} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

async function DateStripSection({
  query,
  sort,
  selectedDate,
  stripStart,
  today,
}: {
  query: Parameters<typeof getDayPrices>[0];
  sort: SortKeyParam;
  selectedDate: string;
  stripStart: string;
  today: string;
}) {
  const prices = await getDayPrices(query, { from: stripStart, days: DATE_STRIP_DAYS });
  const sortParam = sort === DEFAULT_SORT ? null : sort;
  // Every chip keeps the window where it is; only the day changes.
  const href = (date: string, strip: string = stripStart) =>
    `${searchHref(query, { date, sort: sortParam, strip })}`;
  const previous = previousStripStart(stripStart, today, DATE_STRIP_DAYS);
  const next = nextStripStart(stripStart, today, DATE_STRIP_DAYS);
  // Paging moves the window *and* keeps a chip selected: the nearest day inside the new window
  // (the current selection when the new window still contains it).
  const jump = (target: string) =>
    href(clampIntoWindow(target, DATE_STRIP_DAYS, selectedDate, today), target);

  return (
    <DateStrip
      prices={prices}
      selectedDate={selectedDate}
      buildHref={(date) => href(date)}
      pager={{
        label: stripRangeLabel(stripStart, DATE_STRIP_DAYS),
        previousHref: previous ? jump(previous) : null,
        nextHref: next ? jump(next) : null,
        nextUnavailableReason: "بیشتر از این جلو نمی‌رویم؛ تاریخ را از فرم تغییر دهید.",
      }}
    />
  );
}

function DateStripSkeleton() {
  return (
    <div className="card px-2 py-2" aria-hidden="true">
      <div className="grid grid-cols-4 gap-1.5 lg:grid-cols-8">
        {Array.from({ length: DATE_STRIP_DAYS }, (_, index) => (
          <div key={index} className="h-14 animate-pulse rounded-xl bg-ink-100" />
        ))}
      </div>
    </div>
  );
}

function SearchProblem({ reason, missing, invalidDate }: { reason: string; missing: string[]; invalidDate: boolean }) {
  const hint = invalidDate
    ? "تاریخ درخواستی را اصلاح کنید یا اصلاً تاریخ ندهید تا امروز جست‌وجو شود."
    : missing.length > 0
      ? "برای شروع فقط مبدأ و مقصد لازم است؛ تاریخ پیش‌فرض امروز است."
      : "جست‌وجو را دوباره پر کنید.";
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <div className="card p-8 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-saffron-50 text-saffron-600">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-lg font-bold" data-testid="search-error">
          {reason}
        </h1>
        <p className="mt-2 text-sm leading-6 text-ink-500">{hint}</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Link href="/" className="btn-primary text-sm">
            <ArrowRight className="size-4" aria-hidden="true" />
            بازگشت به صفحهٔ اصلی
          </Link>
          {invalidDate && (
            <Link
              href="?"
              className="btn-ghost text-sm"
              title="جست‌وجو بدون تاریخ، یعنی امروز به وقت تهران"
            >
              <CalendarDays className="size-4" aria-hidden="true" />
              جست‌وجو برای امروز
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ query, hasLocalSnapshot }: { query: { originCode: string; destinationCode: string; departDate: string; filters: { dataSource: "all" | "demo" | "real" } }; hasLocalSnapshot: boolean }) {
  return (
    <div className="card p-10 text-center">
      <span className="mx-auto grid size-11 place-items-center rounded-full bg-ink-100 text-ink-500">
        <SearchX className="size-5" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-base font-bold">برای این مسیر و تاریخ پروازی پیدا نشد</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-500">
        {query.filters.dataSource === "real"
          ? hasLocalSnapshot
            ? "snapshot محلی برای این مسیر و تاریخ خوانده شد، اما در این جست‌وجو نرخ قابل نمایش پیدا نشد؛ ممکن است cabin یا اطلاعات ضروری ثبت‌شده با درخواست سازگار نباشد."
            : "برای این مسیر و تاریخ snapshot واقعی محلی در دسترس نیست. snapshotهای ذخیره‌شده در جست‌وجوی اصلی نمایش داده می‌شوند؛ روز دیگری را انتخاب کنید."
          : "دادهٔ نمونه مسیرهای داخلی و منطقه‌ای را پوشش می‌دهد. روز دیگری را از نوار تاریخ بالا انتخاب کنید."}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Link
          href={`/search?origin=${query.originCode}&destination=${query.destinationCode}&date=${addDays(query.departDate, 1)}`}
          className="btn-ghost"
        >
          روز بعد
        </Link>
        <Link href="/" className="btn-primary text-sm">
          جستجوی جدید
        </Link>
      </div>
    </div>
  );
}

function flatten(params: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value) && value[0]) out[key] = value[0];
  }
  return out;
}
