import Link from "next/link";
import { ArrowLeft, CheckCircle2, Info, Sparkles } from "lucide-react";
import type { FlightOffer } from "@/domain/flight";
import type { TripQuery } from "@/domain/trip";
import type { RankedResult } from "@/ranking/score";
import { explainBestOffer } from "@/ai/explain";
import { formatDuration, formatStopsShort, formatToman, toPersianDigits } from "@/lib/format";
import { airlineLabel } from "@/lib/airlines";
import { toSearchParams } from "@/lib/search-params";

/**
 * The AI recommendation card.
 *
 * Server-rendered and deterministic: the explanation comes from the ranking
 * engine's facts, so it is always available — with or without an API key. The
 * `/api/explain` upgrade path can replace the sentence with a model rewrite that
 * passes grounding checks; this card shows the guaranteed version.
 */
export async function RecommendationCard({
  query,
  ranked,
  offer,
  totalCount,
}: {
  query: TripQuery;
  ranked: RankedResult;
  offer: FlightOffer | null;
  totalCount: number;
}) {
  if (!offer) return null;

  // Deterministic template first; a configured LLM may only *rephrase* it and every
  // rewrite must pass the grounding check, otherwise the template is used.
  const { text: explanation, source } = await explainBestOffer(offer, ranked);
  const best = ranked.best;
  const compareParams = toSearchParams(query);
  compareParams.set("compare", `${offer.groupKey}:${offer.id}`);

  return (
    <section
      aria-labelledby="recommendation-heading"
      className="animate-rise relative overflow-hidden rounded-[var(--radius-card)] border border-teal-600/25 bg-gradient-to-bl from-teal-50 via-white to-white p-4 shadow-[var(--shadow-lifted)] sm:p-5"
    >
      <div aria-hidden="true" className="absolute -left-10 -top-10 size-40 rounded-full bg-teal-400/15 blur-3xl" />
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-l from-transparent via-teal-500/50 to-transparent" />

      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="recommendation-heading" className="inline-flex items-center gap-1.5 text-xs font-bold text-teal-700">
            <Sparkles className="size-4" aria-hidden="true" />
            بهترین تطابق
          </h2>

          <p className="mt-2 max-w-2xl text-[0.86rem] leading-8 text-ink-700" data-testid="recommendation-text">
            {explanation}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.7rem]">
            <span className="chip border-teal-200 bg-white text-teal-800">
              {airlineLabel(offer.airlineCode)}
              {offer.flightNumber ? ` · ${offer.flightNumber}` : ""}
            </span>
            <span className="chip">{formatDuration(offer.durationMinutes)}</span>
            <span className="chip">{formatStopsShort(offer.stops)}</span>
            <span className="chip">{offer.baggage.checked === "included" ? "با بار" : offer.baggage.checked === "not-included" ? "بدون بار" : "بار نامشخص"}</span>
            {best && (
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-600/10 px-2 py-1 font-semibold text-teal-800">
                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                امتیاز {toPersianDigits(Math.round(best.score))} از ۱۰۰
              </span>
            )}
            <span
              className="inline-flex items-center gap-1 text-ink-400"
              title={
                source === "llm"
                  ? "بازنویسی هوش مصنوعی، پس از بررسی انطباق با داده‌ها"
                  : "ساخته‌شده از داده‌های همین جستجو، بدون مدل زبانی"
              }
            >
              <Info className="size-3" aria-hidden="true" />
              {source === "llm" ? "بازنویسی هوش مصنوعی" : "توضیح قطعی"}
            </span>
          </div>
        </div>

        <div className="shrink-0 text-left">
          <p className="text-[0.65rem] text-ink-400">قیمت</p>
          <p className="mt-0.5 text-xl font-black text-ink-900 nums">{formatToman(offer.price.toman)}</p>
          <Link
            href={`/compare?${compareParams.toString()}`}
            className="btn-ghost mt-2 text-[0.7rem]"
          >
            مقایسه
            <ArrowLeft className="size-3" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <p className="relative mt-3 border-t border-teal-600/10 pt-2 text-[0.65rem] text-ink-400">
        از {toPersianDigits(totalCount)} پرواز یکتا · قیمت، مدت، توقف، بار، استرداد
      </p>
    </section>
  );
}
