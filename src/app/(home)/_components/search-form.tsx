"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, Loader2, Sparkles, Wand2 } from "lucide-react";
import { CitySelect, SwapButton } from "@/components/ui/city-select";
import { DatePicker } from "@/components/ui/date-picker";
import { CABIN_LABELS, type CabinClass, type TripType } from "@/domain/trip";
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
export function SearchForm({ initialOrigin = "THR", initialDestination = "IST" }: { initialOrigin?: string; initialDestination?: string }) {
  const router = useRouter();
  const today = isoToday();
  const [mode, setMode] = useState<"form" | "nl">("form");
  const [tripType, setTripType] = useState<TripType>("oneway");
  const [origin, setOrigin] = useState(initialOrigin);
  const [destination, setDestination] = useState(initialDestination);
  const [departDate, setDepartDate] = useState(addDays(today, 7));
  const [returnDate, setReturnDate] = useState(addDays(today, 14));
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
    if (tripType === "roundtrip") {
      params.set("trip", "roundtrip");
      params.set("return", returnDate);
    }
    if (passengers !== 1) params.set("pax", String(passengers));
    if (cabin !== "economy") params.set("cabin", cabin);
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    }
    return `/search?${params.toString()}`;
  }

  function submitForm() {
    if (origin === destination) {
      setFormError("مبدأ و مقصد نمی‌توانند یکسان باشند.");
      return;
    }
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
    <div className="card p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl bg-ink-100 p-1" role="tablist" aria-label="نوع جستجو">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "form"}
            onClick={() => setMode("form")}
            className={cn(
              "rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors",
              mode === "form" ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700",
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
              "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors",
              mode === "nl" ? "bg-white text-teal-700 shadow-sm" : "text-ink-500 hover:text-ink-700",
            )}
          >
            <Wand2 className="size-3.5" aria-hidden="true" />
            جستجوی طبیعی
          </button>
        </div>

        <div className="inline-flex rounded-xl border border-ink-200 p-0.5 text-xs" role="group" aria-label="نوع سفر">
          <button
            type="button"
            onClick={() => setTripType("oneway")}
            aria-pressed={tripType === "oneway"}
            className={cn(
              "rounded-lg px-3 py-1.5 font-medium transition-colors",
              tripType === "oneway" ? "bg-teal-600 text-white" : "text-ink-500 hover:text-ink-800",
            )}
          >
            یک‌طرفه
          </button>
          <button
            type="button"
            onClick={() => setTripType("roundtrip")}
            aria-pressed={tripType === "roundtrip"}
            className={cn(
              "rounded-lg px-3 py-1.5 font-medium transition-colors",
              tripType === "roundtrip" ? "bg-teal-600 text-white" : "text-ink-500 hover:text-ink-800",
            )}
          >
            رفت‌وبرگشت
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
            className="field resize-none leading-7 placeholder:text-ink-400"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[0.7rem] leading-5 text-ink-400">
              مبدأ، مقصد، تاریخ و ترجیحات (بار، تعداد توقف، ساعت پرواز، بودجه) استخراج می‌شود.
            </p>
            <button type="submit" disabled={busy} className="btn-primary text-sm">
              {intentPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {intentPending ? "در حال درک درخواست…" : "جستجو با هوش مصنوعی"}
            </button>
          </div>
        </form>
      ) : (
        <div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <CitySelect id="origin" label="مبدأ" value={origin} onChange={setOrigin} placeholder="از کجا؟" />
            <SwapButton onClick={() => { setOrigin(destination); setDestination(origin); }} />
            <CitySelect id="destination" label="مقصد" value={destination} onChange={setDestination} placeholder="به کجا؟" />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <DatePicker id="depart-date" label="تاریخ رفت" value={departDate} onChange={setDepartDate} min={today} />
            {tripType === "roundtrip" ? (
              <DatePicker id="return-date" label="تاریخ برگشت" value={returnDate} onChange={setReturnDate} min={departDate} />
            ) : (
              <div className="hidden lg:block" />
            )}
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
              قیمت‌ها از ارائه‌دهندگان نمونه جمع‌آوری می‌شوند و قیمت لحظه‌ای واقعی نیستند.
            </p>
            <button type="button" onClick={submitForm} disabled={busy} className="btn-primary min-w-[10rem] text-sm">
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
            "mt-3 rounded-lg px-3 py-2 text-xs leading-5",
            formError || intentState.error ? "bg-berry-50 text-berry-600" : "bg-teal-50 text-teal-700",
          )}
        >
          {formError ?? intentState.error ?? nlHint}
        </p>
      )}
    </div>
  );
}
