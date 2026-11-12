import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, ArrowRight, SearchX } from "lucide-react";
import { DEFAULT_SORT, parseSearchParams, SORT_KEYS, type SortKeyParam } from "@/lib/search-params";
import { addDays, formatJalaliFull } from "@/lib/jalali";
import { cityLabel } from "@/lib/cities";
import { toPersianDigits } from "@/lib/format";
import { searchTrips } from "@/server/search-service";
import { recordSearch } from "@/server/persistence";
import { ResultsList } from "@/app/(search)/search/_components/results-list";
import { FilterSidebar } from "@/app/(search)/search/_components/filter-sidebar";
import { SortTabs } from "@/app/(search)/search/_components/sort-tabs";
import { RecommendationCard } from "@/app/(search)/search/_components/recommendation-card";
import { ProviderStrip } from "@/app/(search)/search/_components/provider-strip";
import { SummaryBar } from "@/app/(search)/search/_components/summary-bar";
import { ResultsSkeleton } from "@/app/(search)/search/_components/results-skeleton";
import { MobileFilters } from "@/app/(search)/search/_components/mobile-filters";

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const params = flatten(await searchParams);
  if (!params.origin || !params.destination) return { title: "جستجوی پرواز" };
  return {
    title: `پرواز ${cityLabel(params.origin)} به ${cityLabel(params.destination)}`,
    description: "مقایسهٔ قیمت پرواز از چند ارائه‌دهنده با رتبه‌بندی هوشمند.",
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const raw = flatten(await searchParams);
  const parsed = parseSearchParams(raw);

  if (!parsed.ok) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <div className="card p-8 text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-saffron-50 text-saffron-600">
            <AlertTriangle className="size-5" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-lg font-bold">{parsed.reason}</h1>
          <p className="mt-2 text-sm leading-6 text-ink-500">
            {parsed.missing.length > 0
              ? "برای شروع، مبدأ، مقصد و تاریخ پرواز را انتخاب کنید."
              : "جستجو را دوباره پر کنید."}
          </p>
          <Link href="/" className="btn-primary mt-5 inline-flex text-sm">
            <ArrowRight className="size-4" aria-hidden="true" />
            بازگشت به صفحهٔ اصلی
          </Link>
        </div>
      </div>
    );
  }

  const sortParam = (SORT_KEYS as readonly string[]).includes(raw.sort ?? "") ? (raw.sort as SortKeyParam) : DEFAULT_SORT;
  const view = await searchTrips(parsed.query, sortParam);
  const { outcome, groups } = view;

  // Best-effort audit trail. No DATABASE_URL → no-op; a DB error never breaks the page.
  if (process.env.DATABASE_URL) {
    void recordSearch(outcome, outcome.ranked);
  }
  const query = parsed.query;

  const hasResults = groups.length > 0;
  const providersOk = outcome.health.filter((h) => h.ok).length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <SummaryBar query={query} groupsCount={groups.length} fetchedAt={outcome.fetchedAt} />

      <div className="mt-4 grid gap-4 lg:grid-cols-[17rem_1fr] lg:items-start">
        <aside className="hidden lg:block lg:sticky lg:top-20">
          <FilterSidebar query={query} groups={groups} totalOffers={outcome.offers.length} />
        </aside>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SortTabs current={sortParam} />
            <MobileFilters query={query} groups={groups} totalOffers={outcome.offers.length} />
          </div>

          <div className="mt-4 space-y-4">
            {hasResults ? (
              <>
                <RecommendationCard
                  query={query}
                  ranked={outcome.ranked}
                  offer={outcome.ranked.best?.offer ?? null}
                  totalCount={groups.length}
                />

                <ProviderStrip health={outcome.health} providersOk={providersOk} issues={outcome.issues.length} />

                <Suspense fallback={<ResultsSkeleton />}>
                  <ResultsList query={query} groups={groups} ranked={outcome.ranked.ranked} />
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

function EmptyState({ query }: { query: Parameters<typeof searchTrips>[0] }) {
  return (
    <div className="card p-10 text-center">
      <span className="mx-auto grid size-11 place-items-center rounded-full bg-ink-100 text-ink-500">
        <SearchX className="size-5" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-base font-bold">برای این مسیر و تاریخ پروازی پیدا نشد</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-500">
        دادهٔ نمونه فقط چند مسیر را پوشش می‌دهد. یک روز دیگر را امتحان کنید.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Link
          href={`/search?origin=${query.originCode}&destination=${query.destinationCode}&date=${addDays(query.departDate, 1)}`}
          className="btn-ghost"
        >
          روز بعد ({formatJalaliFull(addDays(query.departDate, 1))})
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
