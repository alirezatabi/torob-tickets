"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, Loader2, Sparkles, Wand2 } from "lucide-react";
import { CitySelect, SwapButton } from "@/components/ui/city-select";
import { DatePicker } from "@/components/ui/date-picker";
import { CABIN_LABELS, type CabinClass } from "@/domain/trip";
import { toPersianDigits } from "@/lib/format";
import { addDays, isoToday } from "@/lib/jalali";
import { cn } from "@/lib/cn";
import { clarificationQuestion } from "@/ai/nlParser";
import { intentAction } from "@/server/intent-action";
import { INITIAL_INTENT_STATE } from "@/server/intent-state";

/**
 * The homepage search surface: conventional form + natural-language box.
 *
 * The NL box calls `/api/intent`, which returns validated structured intent; we
 * then rebuild the *same* URL the form would produce, so both entry points share
 * exactly one search implementation.
 */
export function SearchForm({ initialOrigin = "", initialDestination = "" }: { initialOrigin?: string; initialDestination?: string }) {
  const router = useRouter();
  const today = isoToday();
  const [mode, setMode] = useState<"form" | "nl">("form");
  // Round-trip search is not implemented end to end (B9); the form stays one-way.
  // Mubada/maghsad start **empty** on purpose: a prefilled route is a guess the user never
  // made, and it hides the fact that the search is theirs. The date keeps a default (it is
  // the one field with a sensible "soonest" answer), the two airports do not.
  const [origin, setOrigin] = useState(initialOrigin);
  const [destination, setDestination] = useState(initialDestination);
  const [departDate, setDepartDate] = useState(addDays(today, 7));
  const [passengers, setPassengers] = useState(1);
  const [cabin, setCabin] = useState<CabinClass>("economy");
  const [text, setText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [nlHint, setNlHint] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const lastQuery = useRef("");

  function buildSearchUrl(overrides: Record<string, string | undefined> = {}): string {
    const params = new URLSearchParams({
      origin,
      destination,
      date: departDate,
    });
    if (passengers !== 1) params.set("pax", String(passengers));
    if (cabin !== "economy") params.set("cabin", cabin);
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    }
    return `/search?${params.toString()}`;
  }

  function submitForm() {
    if (!origin || !destination) {
      setFormError("برای جستجو، هم مبدأ و هم مقصد را انتخاب کنید.");
      return;
    }
    if (origin === destination) {
      setFormError("مبدأ و مقصد نمی‌توانند یکسان باشند.");
      return;
    }
    setFormError(null);
    startTransition(() => router.push(buildSearchUrl()));
  }

  // Natural-language submit goes through a server action so the request never
  // depends on a direct browser→API call. Successful parses redirect server-side.
  const [intentState, submitIntent, intentPending] = useActionState(intentAction, INITIAL_INTENT_STATE);

  useEffect(() => {
    if (!intentState.intent) return;
    const { intent } = intentState;
    const missing = intent.missing;

    if (missing.length > 0) {
      if (intent.originCode) setOrigin(intent.originCode);
      if (intent.destinationCode) setDestination(intent.destinationCode);
      if (intent.departDate) setDepartDate(intent.departDate);
      setMode("form");
      setNlHint(`${clarificationQuestion(missing) ?? ""} (${intentState.source === "llm" ? "درک‌شده با هوش مصنوعی" : "درک‌شده با تحلیل متن"})`);
      return;
    }

    const params = new URLSearchParams({
      origin: intent.originCode ?? origin,
      destination: intent.destinationCode ?? destination,
      date: intent.departDate ?? departDate,
      q: lastQuery.current,
    });
    if (intent.maxStops !== null) params.set("stops", String(intent.maxStops));
    if (intent.baggageRequired) params.set("bag", "1");
    if (intent.refundableOnly) params.set("refund", "1");
    if (intent.dayPart) params.set("time", intent.dayPart);
    if (intent.pricePreference !== "balanced") params.set("price", intent.pricePreference);
    if (intent.passengers > 1) params.set("pax", String(intent.passengers));
    if (intent.preferredAirlines.length > 0) params.set("airlines", intent.preferredAirlines.join(","));
    startTransition(() => router.push(`/search?${params.toString()}`));
  }, [intentState, router, origin, destination, departDate]);

  const busy = pending || intentPending;

  return (
    <div className="card home-search-panel relative overflow-hidden p-4 sm:p-5">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-l from-transparent via-teal-400/60 to-transparent" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="segmented" role="tablist" aria-label="نوع جستجو">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "form"}
            onClick={() => setMode("form")}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs font-bold transition-all",
              mode === "form"
                ? "bg-sky-400/15 text-sky-50 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.18)]"
                : "text-slate-300 hover:text-white",
            )}
          >
            جستجوی فرمی
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "nl"}
            onClick={() => setMode("nl")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all",
              mode === "nl"
                ? "bg-teal-600 text-white shadow-[0_1px_2px_rgba(15,23,42,0.12)]"
                : "text-slate-300 hover:text-white",
            )}
          >
            <Wand2 className="size-3.5" aria-hidden="true" />
            جستجوی طبیعی
          </button>
        </div>

        <div className="home-trip-type inline-flex items-center gap-0.5 rounded-full border p-0.5 text-xs" role="group" aria-label="نوع سفر">
          <button
            type="button"
            aria-pressed
            disabled
            className={cn(
              "rounded-full px-3.5 py-1.5 font-semibold transition-colors",
              "bg-teal-600 text-white",
            )}
          >
            یک‌طرفه
          </button>
          {/*
            B9: no provider is queried for the return leg, so offering a round trip would promise
            two directions and show one. The control is disabled and says so instead of quietly
            ignoring the return date the user picked.
          */}
          <button
            type="button"
            disabled
            aria-pressed={false}
            aria-describedby="roundtrip-note"
            title="جست‌وجوی رفت‌وبرگشت هنوز پیاده نشده است؛ فعلاً هر مسیر را جدا جست‌وجو کنید."
            className="cursor-not-allowed rounded-full px-3.5 py-1.5 font-semibold text-ink-300"
          >
            رفت‌وبرگشت
            <span className="mr-1 text-[0.6rem] font-normal">(به‌زودی)</span>
          </button>
        </div>
      </div>

      {mode === "nl" ? (
        <form action={submitIntent} onSubmit={() => { lastQuery.current = text.trim(); }}>
          <label htmlFor="nl-search" className="label flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-saffron-500" aria-hidden="true" />
            درخواست خود را به زبان خودتان بنویسید
          </label>
          <textarea
            id="nl-search"
            name="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            placeholder="مثلاً: ارزان‌ترین پرواز تهران به استانبول جمعه آینده، با بار و بدون توقف"
            className="field resize-none text-[0.95rem] leading-8 placeholder:text-ink-400"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[0.7rem] leading-5 text-ink-400">مسیر، تاریخ و ترجیحات از متن خوانده می‌شود.</p>
            <button type="submit" disabled={busy} className="btn-primary text-sm">
              {intentPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {intentPending ? "در حال درک درخواست…" : "جستجو با هوش مصنوعی"}
            </button>
          </div>
        </form>
      ) : (
        <div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <CitySelect
              id="origin"
              label="مبدأ"
              value={origin}
              onChange={(code) => {
                setOrigin(code);
                setFormError(null);
              }}
              placeholder="از کجا؟"
            />
            <SwapButton onClick={() => { setOrigin(destination); setDestination(origin); setFormError(null); }} />
            <CitySelect
              id="destination"
              label="مقصد"
              value={destination}
              onChange={(code) => {
                setDestination(code);
                setFormError(null);
              }}
              placeholder="به کجا؟"
            />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <DatePicker id="depart-date" label="تاریخ رفت" value={departDate} onChange={setDepartDate} min={today} />
            <div className="hidden lg:block" />
            <div>
              <label htmlFor="passengers" className="label">
                تعداد مسافر
              </label>
              <select
                id="passengers"
                className="field"
                value={passengers}
                onChange={(event) => setPassengers(Number(event.target.value))}
              >
                {Array.from({ length: 9 }, (_, i) => i + 1).map((count) => (
                  <option key={count} value={count}>
                    {toPersianDigits(count)} نفر
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="cabin" className="label">
                کلاس پرواز
              </label>
              <select
                id="cabin"
                className="field"
                value={cabin}
                onChange={(event) => setCabin(event.target.value as CabinClass)}
              >
                {(Object.keys(CABIN_LABELS) as CabinClass[]).map((key) => (
                  <option key={key} value={key}>
                    {CABIN_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[0.7rem] leading-5 text-ink-400">
              قیمت‌ها نمونه‌اند، نه لحظه‌ای.
            </p>
            <button type="button" onClick={submitForm} disabled={busy} className="btn-primary min-w-[11rem] text-sm">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowLeft className="size-4" />}
              جستجوی پرواز
            </button>
          </div>
        </div>
      )}

      {(formError || intentState.error || nlHint) && (
        <p
          role={formError || intentState.error ? "alert" : "status"}
          className={cn(
            "mt-4 rounded-xl px-3 py-2.5 text-xs leading-6",
            formError || intentState.error ? "bg-berry-50 text-berry-600" : "bg-teal-50 text-teal-700",
          )}
        >
          {formError ?? intentState.error ?? nlHint}
        </p>
      )}
    </div>
  );
}
