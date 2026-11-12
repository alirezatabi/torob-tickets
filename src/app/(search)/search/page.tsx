import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, ArrowRight, CalendarDays, SearchX } from "lucide-react";
import { DEFAULT_SORT, parseSearchParams, searchHref, SORT_KEYS, type SortKeyParam } from "@/lib/search-params";
import { addDays, isoToday } from "@/lib/jalali";
import { cityLabel } from "@/lib/cities";
import { toPersianDigits } from "@/lib/format";
import { searchTrips } from "@/server/search-service";
import { getDayPrices, DATE_STRIP_DAYS } from "@/server/day-prices";
import { recordSearch } from "@/server/persistence";
import { ResultsList } from "@/app/(search)/search/_components/results-list";
import { FilterSidebar } from "@/app/(search)/search/_components/filter-sidebar";
import { SortTabs } from "@/app/(search)/search/_components/sort-tabs";
import { RecommendationCard } from "@/app/(search)/search/_components/recommendation-card";
import { ProviderStrip } from "@/app/(search)/search/_components/provider-strip";
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
    description: "هر پرواز یک کارت؛ زیرش قیمت همهٔ فروشنده‌های همان پرواز و ارزان‌ترین‌شان.",
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const raw = flatten(await searchParams);
  // Origin + destination is all the product needs: no date means "today in Tehran" (B1).
  const parsed = parseSearchParams(raw);

  if (!parsed.ok) {
    return <SearchProblem reason={parsed.reason} missing={parsed.missing} invalidDate={parsed.invalid === "date"} />;
  }

  const sortParam = (SORT_KEYS as readonly string[]).includes(raw.sort ?? "")
    ? (raw.sort as SortKeyParam)
    : DEFAULT_SORT;
  const query = parsed.query;
  const view = await searchTrips(query, sortParam);
  const { outcome, flights } = view;

  // Best-effort audit trail. No DATABASE_URL → no-op; a DB error never breaks the page.
  if (process.env.DATABASE_URL) {
    try {
      await recordSearch(outcome, outcome.ranked);
    } catch {
      // Auditing is never allowed to take the results down with it.
    }
  }

  const providersOk = outcome.health.filter((health) => health.ok).length;
  const hasResults = flights.length > 0;
  const stripStart = query.departDate < isoToday() ? isoToday() : query.departDate;

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
          />
        </Suspense>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[17rem_1fr] lg:items-start">
        <aside className="hidden lg:block lg:sticky lg:top-20">
          <FilterSidebar query={query} groups={view.groups} totalOffers={outcome.offers.length} />
        </aside>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SortTabs current={sortParam} />
            <MobileFilters query={query} groups={view.groups} totalOffers={outcome.offers.length} />
          </div>

          <div className="mt-4 space-y-4">
            {hasResults ? (
              <>
                <RecommendationCard
                  query={query}
                  ranked={view.results.rankedView}
                  offer={pickBestOffer(view)}
                  totalCount={flights.length}
                />

                <ProviderStrip health={outcome.health} providersOk={providersOk} issues={outcome.issues.length} />

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
              <EmptyState query={query} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The offer the recommendation card leads with: the best *flight*, at its cheapest seller. */
function pickBestOffer(view: Awaited<ReturnType<typeof searchTrips>>) {
  const bestFlight = view.flights.find((flight) => !flight.soldOut && flight.feasible) ?? view.flights.find((f) => !f.soldOut);
  return bestFlight?.selection.cheapest ?? null;
}

async function DateStripSection({
  query,
  sort,
  selectedDate,
  stripStart,
}: {
  query: Parameters<typeof getDayPrices>[0];
  sort: SortKeyParam;
  selectedDate: string;
  stripStart: string;
}) {
  const prices = await getDayPrices(query, { from: stripStart, days: DATE_STRIP_DAYS });
  return (
    <DateStrip
      prices={prices}
      selectedDate={selectedDate}
      buildHref={(date) => `${searchHref(query, { date, sort: sort === DEFAULT_SORT ? null : sort })}`}
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

function EmptyState({ query }: { query: { originCode: string; destinationCode: string; departDate: string } }) {
  return (
    <div className="card p-10 text-center">
      <span className="mx-auto grid size-11 place-items-center rounded-full bg-ink-100 text-ink-500">
        <SearchX className="size-5" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-base font-bold">برای این مسیر و تاریخ پروازی پیدا نشد</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-500">
        دادهٔ نمونه مسیرهای داخلی و منطقه‌ای را پوشش می‌دهد. روز دیگری را از نوار تاریخ بالا انتخاب کنید.
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
