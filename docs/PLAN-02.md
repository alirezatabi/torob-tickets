# Plan — prompt 02 (bugs + «مقایسهٔ فروشندگان یک پرواز»)

Target: one card per **physical flight**, every seller's price under it, a date strip with
8 days, capacity that actually gates purchasability, and one deterministic
`selectCheapestOffer` used by the card, the strip, the top suggestion and the API.

## Phase A — P0 (each its own commit, `B#` in the message)

1. **B1** `parseSearchParams`: `date` optional → `isoToday()`; a real Jalali/Gregorian
   calendar check (حذف `2026-13-45`) with a Persian reason; `copy` the default, no dead code.
2. **B4** `localDepartDate(offer)` (origin timezone) in `src/lib/time.ts`; used by
   `dedupe/group.ts` (`bucketKeyOf`, `canonicalGroupKey`, `assertNoUnsafeMerge`),
   `modules/providers/orchestrator.ts`, `modules/live/source-link.ts`.
3. **B5** redirect time = local departure `HH:MM`, never `slice(11,16)` of a UTC instant.
4. **B3** `matchesRequestedDate` → real local-day equality (shared helper), `|| true` gone.
5. **B7** `domesticMesh()` in `schedules.ts`: ≥10 non-Tehran city pairs, both directions,
   distance-derived duration/price; IFN→KIH gets IR ~13:00 and Y9 ~19:00 daily.
6. **B8** `Y9` (کیش‌ایر) + any other carrier the mesh needs in `lib/airlines.ts`.
7. **B6** demo `seatsAvailable` = `seededUnit("seats:provider:flight:date")` → 0..9.
8. **B9** round-trip: field hidden behind an honest «به‌زودی» note; no half-working input.

Gate: `typecheck && lint && test`.

## Phase B — core logic (R1–R5)

1. `src/modules/pricing/select-cheapest.ts`: `selectCheapestOffer(group, {passengers, cabin, now})`
   → `{cheapest, cheapestWithBaggage, ineligible[{offer, reason}], savingsToman, spreadToman}`;
   plus `flightCapacity` (**max**, not sum) and `LOW_SEATS_THRESHOLD = 5`.
2. `src/modules/search/results.ts`: `buildFlightResults(offers, query, {now, sort})` —
   search → normalize → group → `selectCheapestOffer` → rank **the flight** via
   `fromGroup` (real `sellerCount`) → sort (sold-out last). `sort` gets an
   `earliest` key, so the four tabs really differ.
3. `prepareResultList` / `searchTrips` / `/api/search` return those flights; the page and
   `ResultsList` render them (B2 fixed by construction).
4. `getDayPrices(query, {from, days: 8, now})` + `DateStrip` (RTL, keyboard, horizontal on
   mobile, «—» for no flight, no `۰`, links keep every other param).
5. Card: capacity, «کم», «ظرفیت کافی نیست» greyed, «تکمیل ظرفیت» last, per-person **and**
   total price, all sellers with the delta from the cheapest.

Gate + `/api/search` + compare page still green.

## Phase C — P1/P2 in prompt order

B10 (`jalaliMonthLength`), B11 (Jalali validation), B12 (nlParser weekday/word boundaries),
B13 (no mutation in `groupOffers`), B14 (score ⇄ core cycle), B15 (`now` reaches adapters),
B16 (airline filter = hard **or** soft, one meaning), B17 (README = code, test count from
code), B18 (`seededUnit` → `/ 2**32`, one copy), B19 (transitive comparator, code-point
tie-break), B20 (`WEEKEND` = Thu/Fri), B21 (in-process cache caveat in README), B22 (await
the audit write), B23 (`/api/explain`, `/api/intent` limits + tests), S1 (no `.env`, rotate
notice, `.env.example` only).

## Phase D — validation

`typecheck`, `lint`, `npm test`, `next build`, `npm run test:e2e` (browsers cannot be
downloaded in this sandbox → specs are written and the limitation is reported), a real
`next start` walkthrough of اصفهان←کیش with no date, README/route counts recomputed from
code, then the §9 report.

Decisions I am taking now: default sort = **ارزان‌ترین**; `LOW_SEATS_THRESHOLD = 5` (named
constant); «ارزان‌ترین با بار» = at most **15 %** more expensive; flight capacity = max of
known purchasable offers; a search whose day is today hides flights inside
`SALES_CUTOFF_MINUTES = 90`.
