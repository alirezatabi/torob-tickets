"use client";

import { useMemo, useState } from "react";
import type { CrawlSnapshot, RawOffer } from "@/crawler/types";
import { groupCrawledTickets } from "@/crawler/tickets";

const digits = new Intl.NumberFormat("fa-IR");
const iranDateTime = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  timeZone: "Asia/Tehran", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
});
const iranDate = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", year: "numeric", month: "long", day: "numeric" });

type Ticket = ReturnType<typeof groupCrawledTickets>[number];
type SortMode = "cheapest" | "expensive" | "departure" | "code";

export function CrawledOffersBrowser({ snapshot, sourceName }: { snapshot: CrawlSnapshot; sourceName: string }) {
  const [search, setSearch] = useState("");
  const [airlineFilter, setAirlineFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [stopsFilter, setStopsFilter] = useState("all");
  const [maxPrice, setMaxPrice] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("cheapest");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  const tickets = useMemo(() => groupCrawledTickets(snapshot.offers), [snapshot.offers]);
  const airlineOptions = useMemo(() => unique(tickets.flatMap((ticket) => ticket.offers.map((offer) => airlineLabel(offer)).filter(Boolean))), [tickets]);
  const providerOptions = useMemo(() => unique(tickets.flatMap((ticket) => ticket.offers.map((offer) => providerLabel(offer)).filter(Boolean))), [tickets]);
  const classOptions = useMemo(() => unique(tickets.flatMap((ticket) => ticket.offers.map((offer) => readText(offer, "flightClass")).filter(Boolean))), [tickets]);
  const allSelected = useMemo(() => tickets.filter((ticket) => selectedKeys.includes(ticket.key)), [tickets, selectedKeys]);

  const filteredTickets = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    const ceiling = maxPrice.trim() ? Number(maxPrice) : Number.POSITIVE_INFINITY;
    const filtered = tickets.flatMap((ticket) => {
      if (airlineFilter !== "all" && !ticket.offers.some((offer) => airlineLabel(offer) === airlineFilter)) return [];
      if (classFilter !== "all" && !ticket.offers.some((offer) => readText(offer, "flightClass") === classFilter)) return [];
      if (stopsFilter !== "all" && !ticket.offers.some((offer) => matchesStops(readNumber(offer, "stopsCount"), stopsFilter))) return [];

      const offers = ticket.offers.filter((offer) => {
        if (providerFilter !== "all" && providerLabel(offer) !== providerFilter) return false;
        const amount = offer.amount;
        if (Number.isFinite(ceiling) && (typeof amount !== "number" || amount > ceiling)) return false;
        return true;
      });
      if (offers.length === 0) return [];
      if (term) {
        const text = [ticket.code, ...offers.flatMap((offer) => [airlineLabel(offer), providerLabel(offer), readText(offer, "origin"), readText(offer, "destination")])]
          .filter(Boolean).join(" ").toLocaleLowerCase();
        if (!text.includes(term)) return [];
      }
      return [{ ...ticket, offers: sortOffers(offers) }];
    });

    return filtered.sort((a, b) => {
      if (sortMode === "code") return a.code.localeCompare(b.code);
      if (sortMode === "departure") return departureSort(a).localeCompare(departureSort(b));
      const delta = lowestPrice(a) - lowestPrice(b);
      return sortMode === "expensive" ? -delta : delta;
    });
  }, [tickets, search, airlineFilter, providerFilter, classFilter, stopsFilter, maxPrice, sortMode]);

  function toggleTicket(key: string) {
    const alreadySelected = selectedKeys.includes(key);
    if (!alreadySelected && selectedKeys.length >= 3) return;
    if (!alreadySelected && selectedKeys.length === 1) setCompareOpen(true);
    setSelectedKeys((current) => alreadySelected ? current.filter((item) => item !== key) : [...current, key]);
  }

  function resetFilters() {
    setSearch(""); setAirlineFilter("all"); setProviderFilter("all"); setClassFilter("all"); setStopsFilter("all"); setMaxPrice(""); setSortMode("cheapest");
  }

  return <section className="overflow-hidden rounded-3xl border border-ink-200 bg-white shadow-sm">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-100 bg-ink-50/70 p-5 sm:p-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-black text-ink-900">{sourceName}</h2>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">snapshot محلی</span>
        </div>
        <p className="mt-2 text-sm text-ink-600">مسیر <b dir="ltr">{snapshot.route}</b><span className="px-1">·</span> تاریخ {formatDate(snapshot.date)}</p>
        <p className="mt-1 text-xs text-ink-500">دریافت {formatInstant(snapshot.fetchedAt)} به وقت ایران · قیمت تومان · ساعت Asia/Tehran</p>
      </div>
      <div className="flex gap-2">
        <Metric value={digits.format(snapshot.offers.length)} label="نرخ فروشنده‌ها" />
        <Metric value={digits.format(tickets.length)} label="کد پرواز یکتا" />
      </div>
    </header>

    <div className="grid gap-3 border-b border-ink-100 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="sm:col-span-2">
        <span className="mb-1 block text-xs font-bold text-ink-600">جستجوی کد، ایرلاین یا فروشنده</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="مثلاً FP7438 یا نام فروشنده" className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100" />
      </label>
      <FilterSelect label="ایرلاین" value={airlineFilter} onChange={setAirlineFilter} options={airlineOptions} />
      <FilterSelect label="فروشنده" value={providerFilter} onChange={setProviderFilter} options={providerOptions} />
      <FilterSelect label="کلاس پرواز" value={classFilter} onChange={setClassFilter} options={classOptions} />
      <label>
        <span className="mb-1 block text-xs font-bold text-ink-600">توقف</span>
        <select value={stopsFilter} onChange={(event) => setStopsFilter(event.target.value)} className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm">
          <option value="all">همه</option><option value="0">بدون توقف</option><option value="1">۱ توقف</option><option value="2+">۲ توقف یا بیشتر</option><option value="unknown">نامشخص</option>
        </select>
      </label>
      <label>
        <span className="mb-1 block text-xs font-bold text-ink-600">حداکثر قیمت (تومان)</span>
        <input inputMode="numeric" type="number" min="0" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="بدون محدودیت" className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-600" />
      </label>
      <label>
        <span className="mb-1 block text-xs font-bold text-ink-600">مرتب‌سازی</span>
        <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm">
          <option value="cheapest">ارزان‌ترین</option><option value="expensive">گران‌ترین</option><option value="departure">زمان حرکت</option><option value="code">کد پرواز</option>
        </select>
      </label>
      <div className="flex items-end justify-between gap-3">
        <p className="pb-2 text-xs text-ink-500">{digits.format(filteredTickets.length)} کد پرواز از {digits.format(tickets.length)}</p>
        <button type="button" onClick={resetFilters} className="rounded-lg px-3 py-2 text-xs font-bold text-teal-700 hover:bg-teal-50">پاک‌کردن فیلترها</button>
      </div>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
      <p className="text-xs leading-5 text-ink-500">هر کد پرواز یک بلیت است؛ نرخ‌های فروشنده‌های همان کد زیر همان بلیت گروه‌بندی شده‌اند.</p>
      <button type="button" disabled={selectedKeys.length < 2} onClick={() => setCompareOpen((open) => !open)} className="rounded-xl bg-ink-900 px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-ink-300">
        مقایسهٔ انتخاب‌ها ({digits.format(selectedKeys.length)}/۳)
      </button>
    </div>

    {filteredTickets.length === 0 ? <p className="p-8 text-center text-sm text-ink-500">با این فیلترها بلیتی پیدا نشد.</p> : <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
      {filteredTickets.map((ticket) => <TicketCard key={ticket.key} ticket={ticket} source={snapshot.source} selected={selectedKeys.includes(ticket.key)} canSelect={selectedKeys.length < 3 || selectedKeys.includes(ticket.key)} onToggle={() => toggleTicket(ticket.key)} />)}
    </div>}

    {compareOpen && allSelected.length >= 2 && <section className="border-t border-ink-200 bg-teal-50/50 p-4 sm:p-6" aria-live="polite">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><h3 className="text-lg font-black text-ink-900">مقایسهٔ بلیت‌ها</h3><p className="mt-1 text-xs text-ink-600">قیمت هر بلیت، ارزان‌ترین نرخ ثبت‌شده بین فروشنده‌های همان کد است.</p></div>
        <button type="button" onClick={() => setCompareOpen(false)} className="rounded-lg px-3 py-2 text-xs font-bold text-ink-600 hover:bg-white">بستن</button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {allSelected.map((ticket) => <CompareCard key={ticket.key} ticket={ticket} source={snapshot.source} onRemove={() => toggleTicket(ticket.key)} />)}
      </div>
    </section>}
  </section>;
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div className="min-w-24 rounded-2xl bg-white px-3 py-2 text-center shadow-sm ring-1 ring-ink-100"><div className="text-xl font-black tabular-nums text-ink-900">{value}</div><div className="mt-1 text-[0.65rem] text-ink-500">{label}</div></div>;
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label>
    <span className="mb-1 block text-xs font-bold text-ink-600">{label}</span>
    <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm">
      <option value="all">همه</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  </label>;
}

function TicketCard({ ticket, source, selected, canSelect, onToggle }: { ticket: Ticket; source: string; selected: boolean; canSelect: boolean; onToggle: () => void }) {
  const first = ticket.offers[0];
  const lowest = sortOffers(ticket.offers)[0];
  if (!first || !lowest) return null;
  const airline = airlineLabel(first) || "ایرلاین نامشخص";
  const offerClass = readText(first, "flightClass");

  return <article className={`rounded-2xl border p-4 transition-shadow hover:shadow-md ${selected ? "border-teal-500 bg-teal-50/30 ring-1 ring-teal-200" : "border-ink-200 bg-white"}`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-black text-ink-900" dir="ltr">{ticket.code}</h3>{offerClass && <span className="rounded-full bg-ink-100 px-2 py-1 text-[0.65rem] text-ink-600">{offerClass}</span>}</div>
        <p className="mt-1 text-sm text-ink-600">{airline}</p>
      </div>
      <label className="flex cursor-pointer items-center gap-1.5 text-xs font-bold text-teal-800">
        <input type="checkbox" checked={selected} disabled={!canSelect} onChange={onToggle} className="size-4 accent-teal-700" /> مقایسه
      </label>
    </div>

    <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-ink-50 p-3 text-sm">
      <div><div className="text-[0.65rem] text-ink-500">مبدأ</div><div dir="ltr" className="mt-1 font-bold text-ink-800">{readText(first, "origin") ?? "—"}</div></div>
      <div><div className="text-[0.65rem] text-ink-500">مقصد</div><div dir="ltr" className="mt-1 font-bold text-ink-800">{readText(first, "destination") ?? "—"}</div></div>
      <div><div className="text-[0.65rem] text-ink-500">حرکت · ایران</div><div className="mt-1 font-semibold text-ink-800">{formatFlightTime(first, "departureLocal", "departAt")}</div></div>
      <div><div className="text-[0.65rem] text-ink-500">رسیدن · ایران</div><div className="mt-1 font-semibold text-ink-800">{formatFlightTime(first, "arrivalLocal", "arriveAt")}</div></div>
      <div><div className="text-[0.65rem] text-ink-500">توقف / ظرفیت</div><div className="mt-1 font-semibold text-ink-800">{numberLabel(first, "stopsCount", "توقف")} <span className="px-1 text-ink-300">·</span> {numberLabel(first, "seats", "صندلی")}</div></div>
      <div className="text-left"><div className="text-[0.65rem] text-ink-500">از</div><div className="mt-1 font-black text-teal-800">{priceLabel(lowest, source)}</div></div>
    </div>

    <div className="mt-3 border-t border-ink-100 pt-3">
      <p className="mb-2 text-[0.68rem] font-bold text-ink-500">نرخ فروشنده‌ها ({digits.format(ticket.offers.length)})</p>
      <ul className="space-y-1.5">
        {sortOffers(ticket.offers).slice(0, 4).map((offer, index) => <li key={`${readText(offer, "id") ?? ticket.key}-${index}`} className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate text-ink-600">{providerLabel(offer) || "فروشنده نامشخص"}</span><span className="whitespace-nowrap font-bold text-ink-800">{priceLabel(offer, source)}</span>
        </li>)}
      </ul>
      {ticket.offers.length > 4 && <p className="mt-2 text-[0.65rem] text-ink-400">{digits.format(ticket.offers.length - 4)} نرخ دیگر</p>}
    </div>
  </article>;
}

function CompareCard({ ticket, source, onRemove }: { ticket: Ticket; source: string; onRemove: () => void }) {
  const best = sortOffers(ticket.offers)[0];
  const first = ticket.offers[0];
  if (!best || !first) return null;
  return <article className="rounded-2xl border border-ink-200 bg-white p-4">
    <div className="flex items-start justify-between gap-2"><div><p className="font-black text-ink-900" dir="ltr">{ticket.code}</p><p className="mt-1 text-xs text-ink-500">{airlineLabel(first) || "ایرلاین نامشخص"}</p></div><button type="button" onClick={onRemove} className="text-xs font-bold text-rose-700">حذف</button></div>
    <dl className="mt-3 space-y-2 text-xs">
      <CompareFact label="مسیر" value={`${readText(first, "origin") ?? "—"} → ${readText(first, "destination") ?? "—"}`} />
      <CompareFact label="حرکت / رسیدن" value={`${formatFlightTime(first, "departureLocal", "departAt")} / ${formatFlightTime(first, "arrivalLocal", "arriveAt")}`} />
      <CompareFact label="توقف" value={numberLabel(first, "stopsCount", "توقف")} />
      <CompareFact label="ظرفیت" value={numberLabel(first, "seats", "صندلی")} />
      <CompareFact label="ارزان‌ترین فروشنده" value={providerLabel(best) || "نامشخص"} />
    </dl>
    <div className="mt-4 border-t border-ink-100 pt-3"><div className="text-[0.65rem] text-ink-500">کمترین قیمت</div><div className="mt-1 text-xl font-black text-teal-800">{priceLabel(best, source)}</div></div>
    <ul className="mt-3 space-y-1 border-t border-ink-100 pt-3">{sortOffers(ticket.offers).map((offer, index) => <li key={`${readText(offer, "id") ?? ticket.key}-${index}`} className="flex justify-between gap-2 text-[0.68rem]"><span className="truncate text-ink-500">{providerLabel(offer) || "فروشنده نامشخص"}</span><span className="whitespace-nowrap font-semibold text-ink-700">{priceLabel(offer, source)}</span></li>)}</ul>
  </article>;
}

function CompareFact({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><dt className="shrink-0 text-ink-500">{label}</dt><dd className="text-left font-semibold text-ink-800">{value}</dd></div>;
}

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "fa"));
}
function readText(offer: RawOffer, key: string): string | null {
  const value = offer[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function readNumber(offer: RawOffer, key: string): number | null {
  const value = offer[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function airlineLabel(offer: RawOffer): string | null { return readText(offer, "airlineNameFa") ?? readText(offer, "airline") ?? readText(offer, "airlineCode"); }
function providerLabel(offer: RawOffer): string | null { return readText(offer, "providerName") ?? readText(offer, "providerId"); }
function priceLabel(offer: RawOffer, source: string): string {
  const amount = readNumber(offer, "amount");
  if (amount === null) return "قیمت نامشخص";
  const currency = readText(offer, "currency");
  const unit = source === "safarmarket" || currency === "IRT" ? "تومان" : currency ?? "واحد نامشخص";
  return `${digits.format(Math.round(amount))} ${unit}`;
}
function sortOffers(offers: RawOffer[]): RawOffer[] {
  return [...offers].sort((a, b) => (readNumber(a, "amount") ?? Number.POSITIVE_INFINITY) - (readNumber(b, "amount") ?? Number.POSITIVE_INFINITY));
}
function lowestPrice(ticket: Ticket): number {
  const offer = sortOffers(ticket.offers)[0];
  return offer ? readNumber(offer, "amount") ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
}
function departureSort(ticket: Ticket): string {
  const first = ticket.offers[0];
  return first ? readText(first, "departureLocal") ?? readText(first, "departAt") ?? "" : "";
}
function matchesStops(count: number | null, filter: string): boolean {
  if (filter === "unknown") return count === null;
  if (count === null) return false;
  if (filter === "2+") return count >= 2;
  return count === Number(filter);
}
function numberLabel(offer: RawOffer, key: string, unit: string): string {
  const value = readNumber(offer, key);
  return value === null ? "نامشخص" : `${digits.format(value)} ${unit}`;
}
function formatFlightTime(offer: RawOffer, localKey: string, instantKey: string): string {
  const instant = readText(offer, instantKey);
  if (instant && Number.isFinite(Date.parse(instant))) return iranDateTime.format(new Date(instant));
  const local = readText(offer, localKey);
  return local ? local.replace("T", " ") : "نامشخص";
}
function formatInstant(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? iranDateTime.format(date) : value;
}
function formatDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) ? iranDate.format(date) : value;
}
