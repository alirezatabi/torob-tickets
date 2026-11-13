import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, GitCompareArrows, Minus, TriangleAlert } from "lucide-react";
import { parseSearchParams } from "@/lib/search-params";
import { formatJalaliFull } from "@/lib/jalali";
import { cityLabel, getCity } from "@/lib/cities";
import { formatDuration, formatStopsShort, formatTimeInZone, formatToman, toPersianDigits } from "@/lib/format";
import { searchTrips } from "@/server/search-service";
import { isGroupKey } from "@/dedupe/group";
import { explainTradeoff, refundLabel, baggageLabel } from "@/ranking/explain";
import type { FlightOffer, OfferGroup } from "@/domain/flight";
import type { ScoredOffer } from "@/ranking/score";
import { DemoBadge } from "@/components/ui/demo-badge";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "مقایسهٔ گزینه‌ها",
  description: "قیمت، مدت، توقف، بار و استرداد چند پرواز کنار هم.",
};

interface ComparePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ComparePage({ searchParams }: ComparePageProps) {
  const raw = flatten(await searchParams);
  const parsed = parseSearchParams(raw);

  if (!parsed.ok) {
    return <CompareError message={parsed.reason} />;
  }

  const query = parsed.query;
  const view = await searchTrips(query, "best");
  // Fresh links send "<groupKey>:<offerId>". Group keys themselves contain "|" and
  // ">" (but no ":"), so search params arriving URL-decoded must be split from the
  // RIGHT: everything before the last ":" is the key, after it the offer id.
  const rawSelection = raw.groups ?? raw.compare ?? "";
  const tokens = rawSelection
    ? rawSelection
        .split(",")
        .map((token) => {
          const index = token.lastIndexOf(":");
          // Offer ids look like "provider:rawId" and *do* contain ":", so a token is
          // only split when the left part is a real group key.
          if (index <= 0 || !isGroupKey(token.slice(0, index))) {
            return { groupKey: "", offerId: token };
          }
          return { groupKey: token.slice(0, index), offerId: token.slice(index + 1) };
        })
        .filter((token) => token.groupKey.length > 0 || token.offerId.length > 0)
        .slice(0, 3)
    : [];
  // Accept whatever the URL carried: "<groupKey>:<offerId>" or a bare group key
  // (the latter is what old/bookmarked links contain). Resolve to a concrete offer
  // from normalized data only — never from the client's numbers.
  const resolved: { groupKey: string; offerId: string }[] = [];
  for (const token of tokens) {
    const matchingOffers = view.outcome.offers.filter(
      (offer) => offer.groupKey === token.groupKey || offer.id === token.offerId || offer.id === token.groupKey,
    );
    if (matchingOffers.length === 0) continue;
    const exact =
      matchingOffers.find((offer) => offer.id === token.offerId) ?? matchingOffers.find((offer) => offer.id === token.groupKey);
    const group = findGroupByKey(view.outcome.offers, token.groupKey);
    // All offers of one group are the same physical flight; show the cheapest quote.
    const offer =
      exact ?? group ?? [...matchingOffers].sort((a, b) => a.price.toman - b.price.toman)[0] ?? null;
    if (offer) resolved.push({ groupKey: offer.groupKey, offerId: offer.id });
  }
  const deduped = resolved.filter(
    (item, index) => resolved.findIndex((other) => other.groupKey === item.groupKey) === index,
  );

  const rows = deduped
    .map((token) => {
      const offer =
        view.outcome.offers.find((candidate) => candidate.id === token.offerId) ??
        findGroupByKey(view.outcome.offers, token.groupKey);
      // The score belongs to the *flight*; the offer is its cheapest purchasable seller.
      const scored = offer
        ? (view.results.rankedView.ranked.find((entry) => entry.offer.groupKey === offer.groupKey) ?? null)
        : null;
      return offer && scored ? { offer, scored } : null;
    })
    .filter((item): item is { offer: FlightOffer; scored: ScoredOffer } => item !== null);

  if (rows.length === 0) {
    return (
      <CompareError
        message="گزینه‌ای انتخاب نشده"
        hint="از فهرست نتایج، دو یا سه پرواز را به مقایسه اضافه کنید."
        backHref={`/search?origin=${query.originCode}&destination=${query.destinationCode}&date=${query.departDate}`}
      />
    );
  }

  const best = [...rows].sort((a, b) => b.scored.score - a.scored.score)[0];
  const tradeoff = rows.length >= 2 && rows[0] && rows[1] ? explainTradeoff(rows[0].scored, rows[1].scored) : "";

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-bold">
            مقایسهٔ {toPersianDigits(rows.length)} گزینه — {cityLabel(query.originCode)} به {cityLabel(query.destinationCode)}
          </h1>
          <p className="mt-1 text-[0.72rem] text-ink-500">
            {formatJalaliFull(query.departDate)} · {toPersianDigits(query.passengers)} مسافر
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DemoBadge />
          <Link
            href={`/search?origin=${query.originCode}&destination=${query.destinationCode}&date=${query.departDate}`}
            className="btn-ghost text-xs"
          >
            <ArrowRight className="size-3.5" aria-hidden="true" />
            بازگشت به نتایج
          </Link>
        </div>
      </div>

      {rows.length > 1 ? (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-teal-600/20 bg-gradient-to-l from-teal-50 to-white px-4 py-3 shadow-sm">
        <GitCompareArrows className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden="true" />
        <p className="text-[0.74rem] leading-6 text-teal-900">
          <span className="font-semibold">تفاوت: </span>
          {tradeoff}
          {best && (
            <span className="block text-teal-700">
              بالاترین تطابق: {best.offer.airlineName} ({toPersianDigits(Math.round(best.scored.score))})
            </span>
          )}
        </p>
        </div>
      ) : (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2.5">
          <GitCompareArrows className="mt-0.5 size-4 shrink-0 text-ink-500" aria-hidden="true" />
          <p className="text-[0.74rem] leading-6 text-ink-600">
            یک گزینه انتخاب شده است. برای مقایسهٔ رو‌به‌رو، گزینهٔ دومی هم اضافه کنید.
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-right" data-testid="compare-table">
          <caption className="sr-only">جدول مقایسهٔ گزینه‌های انتخاب‌شده</caption>
          <thead>
            <tr>
              <th scope="col" className="w-32 pb-2 text-[0.68rem] font-medium text-ink-400">
                معیار
              </th>
              {rows.map(({ offer }) => (
                <th key={offer.id} scope="col" className="pb-2 align-bottom">
                  <div className="card card-hover p-3">
                    <p className="text-[0.8rem] font-extrabold text-ink-900">{offer.airlineName}</p>
                    <p className="mt-0.5 text-[0.62rem] text-ink-400">{offer.flightNumber ?? "شماره نامشخص"}</p>
                    <p className="mt-1.5 text-[1.05rem] font-black text-ink-900 nums">{formatToman(offer.price.toman)}</p>
                    <p className="text-[0.6rem] text-ink-400">از {offer.providerName}</p>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row
              label="مدت سفر"
              rows={rows}
              values={(offer) => formatDuration(offer.durationMinutes)}
              highlights={(offer) => offer.durationMinutes === minOf(rows, (item) => item.durationMinutes)}
              highlightLabel="سریع‌ترین"
            />
            <Row
              label="قیمت"
              rows={rows}
              values={(offer) => formatToman(offer.price.toman)}
              highlights={(offer) => offer.price.toman === minOf(rows, (item) => item.price.toman)}
              highlightLabel="ارزان‌ترین"
            />
            <Row label="تعداد توقف" rows={rows} values={(offer) => formatStopsShort(offer.stops)} />
            <Row
              label="ساعت حرکت"
              rows={rows}
              values={(offer) => formatTimeInZone(offer.departAt, getCity(offer.originCode)?.timezone ?? "Asia/Tehran")}
            />
            <Row
              label="ساعت رسیدن"
              rows={rows}
              values={(offer) => formatTimeInZone(offer.arriveAt, getCity(offer.destinationCode)?.timezone ?? "Asia/Tehran")}
            />
            <Row
              label="بار همراه"
              rows={rows}
              values={(offer) => baggageLabel(offer)}
              unknown={(offer) => offer.baggage.checked === "unknown"}
            />
            <Row
              label="شرایط استرداد"
              rows={rows}
              values={(offer) => refundLabel(offer)}
              unknown={(offer) => offer.refundable === null}
            />
            <Row label="ارائه‌دهنده" rows={rows} values={(offer) => offer.providerName} />
            <Row
              label="امتیاز تطابق"
              rows={rows}
              values={(_offer, scored) => `${toPersianDigits(Math.round(scored.score))} از ۱۰۰`}
              highlights={(_offer, scored) => scored === best?.scored}
              highlightLabel="بهترین تطابق"
            />
            <tr>
              <td />
              {rows.map(({ offer }) => (
                <td key={offer.id} className="pt-3">
                  <span className="block w-full rounded-lg bg-ink-100 px-2 py-2 text-center text-[0.7rem] text-ink-500">
                    دادهٔ نمونه · {offer.providerName}
                  </span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="نرخ ارائه‌دهندگان">
        {rows.map(({ offer }) => {
          const group = view.outcome.offers.find((candidate) => candidate.groupKey === offer.groupKey);
          const providers = group ? [group] : [];
          return (
            <div key={`providers-${offer.id}`} className="card p-3">
              <h2 className="text-[0.72rem] font-bold text-ink-800">
                نرخ {offer.airlineName}
                {providers.length > 0 && ` · ${toPersianDigits(countProviders(view.outcome.offers, offer.groupKey))} منبع`}
              </h2>
              <ul className="mt-2 space-y-1">
                {view.outcome.offers
                  .filter((candidate) => candidate.groupKey === offer.groupKey)
                  .sort((a, b) => a.price.toman - b.price.toman)
                  .map((candidate) => (
                    <li key={candidate.id} className="flex items-center justify-between text-[0.68rem] text-ink-600">
                      <span>{candidate.providerName}</span>
                      <span className="nums font-medium text-ink-800">{formatToman(candidate.price.toman)}</span>
                    </li>
                  ))}
              </ul>
            </div>
          );
        })}
      </section>

      <p className="mt-6 text-[0.65rem] leading-5 text-ink-400">
        «نامشخص» یعنی منبع آن را اعلام نکرده؛ حدس نمی‌زنیم. قیمت‌ها نمونه‌اند، نه لحظه‌ای.
      </p>
    </div>
  );
}

/** All offers that belong to the same physical flight, cheapest first. */
function findGroupByKey(offers: FlightOffer[], groupKey: string): FlightOffer | null {
  const members = offers.filter((offer) => offer.groupKey === groupKey);
  if (members.length === 0) return null;
  return [...members].sort((a, b) => a.price.toman - b.price.toman)[0] ?? null;
}

function countProviders(offers: FlightOffer[], groupKey: string): number {
  return new Set(offers.filter((offer) => offer.groupKey === groupKey).map((offer) => offer.providerId)).size;
}

function minOf(rows: { offer: FlightOffer }[], pick: (offer: FlightOffer) => number): number {
  return Math.min(...rows.map((row) => pick(row.offer)));
}

function Row({
  label,
  rows,
  values,
  highlights,
  highlightLabel,
  unknown,
}: {
  label: string;
  rows: { offer: FlightOffer; scored: ScoredOffer }[];
  values: (offer: FlightOffer, scored: ScoredOffer) => string;
  highlights?: (offer: FlightOffer, scored: ScoredOffer) => boolean;
  highlightLabel?: string;
  unknown?: (offer: FlightOffer) => boolean;
}) {
  return (
    <tr className="[&>td]:border-t [&>td]:border-ink-100">
      <th scope="row" className="py-2.5 pl-2 text-[0.68rem] font-medium text-ink-500">
        {label}
      </th>
      {rows.map(({ offer, scored }) => {
        const isUnknown = unknown?.(offer) ?? false;
        const isHighlight = highlights?.(offer, scored) ?? false;
        return (
          <td key={offer.id} className="px-1.5 py-2.5">
            <span
              className={cn(
                "inline-flex flex-wrap items-center gap-1 rounded-lg px-2 py-1 text-[0.72rem]",
                isUnknown
                  ? "bg-ink-100 text-ink-500"
                  : isHighlight
                    ? "bg-teal-50 font-semibold text-teal-800"
                    : "text-ink-800",
              )}
            >
              {isUnknown && <TriangleAlert className="size-3" aria-hidden="true" />}
              {isHighlight && !isUnknown && <Check className="size-3" aria-hidden="true" />}
              {isUnknown ? "نامشخص" : values(offer, scored)}
              {isHighlight && highlightLabel && !isUnknown && (
                <span className="rounded bg-teal-600 px-1 text-[0.55rem] font-semibold text-white">{highlightLabel}</span>
              )}
            </span>
          </td>
        );
      })}
    </tr>
  );
}

function CompareError({ message, hint, backHref = "/" }: { message: string; hint?: string; backHref?: string }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <div className="card p-8 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-ink-100 text-ink-500">
          <Minus className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-lg font-bold">{message}</h1>
        {hint && <p className="mt-2 text-sm leading-6 text-ink-500">{hint}</p>}
        <Link href={backHref} className="btn-primary mt-5 inline-flex text-sm">
          <ArrowRight className="size-4" aria-hidden="true" />
          {backHref === "/" ? "صفحهٔ اصلی" : "بازگشت به نتایج"}
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

export type { OfferGroup };
