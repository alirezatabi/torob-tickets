# Phase 4 — Verification report

Date: 2026-11-12 · Branch: `arena/b4963fa8-torob-tickets` · Scope: "real data upgrade" (Sepehr360 + Amadeus, Postgres, price history)

This report separates what is **verified here** from what **only the operator can verify**.
Nothing below was inferred: every line either names a command whose output is pasted, or is
marked unverified.

---

## 1. Working (verified in this environment)

### 1.1 Static quality gates

```
npx tsc --noEmit      → clean (0 errors)
npx eslint .          → clean (0 errors, 0 warnings)
npx vitest run        → 25 files, 251 tests, all passing
npx next build        → OK; routes: /, /search, /compare, /live, /live/history,
                        /api/health, /api/live/search, /api/live/history (+ existing)
```

Fixture-only: no test opens a socket to a provider (verified by inspection of the test
files and by the `HttpClient` stub used in `live-http`, `sepehr360-adapter`).

### 1.2 Sepehr360 parse + normalize (fixture captured from the real page shape)

```
SEPEHR cards=4 accepted=4 rejected=0
{ "id": "sepehr360:air:IR|flt:?|rt:THR>MHD|day:2026-11-13|cab:economy|fc:?|bag:checked-unknown|ref:unknown|tt:unknown|mk:?",
  "g": "IR|~|2026-11-13|THR|MHD", "price": 5902000, "cur": "IRT",
  "dep": "2026-11-13T04:00:00.000Z", "arr": "2026-11-13T05:20:00.000Z",
  "dur": 80, "stops": 0, "fr": "fresh", "comp": 0.07,
  "warn": ["availability-unverified","baggage-unknown","flight-number-missing","refund-unknown","seller-aggregated"],
  "seller": "فروش توسط 128 سایت مختلف" }
…
{ "id": "sepehr360:…|cab:business|…", "price": 9750000, "stops": 0 }   ← business row stays separate
{ "…cab:economy…", "price": 4850000, "stops": 1, "warn": […, "stops-partial"] }
```

What this proves:

- Persian digits/separators parse to exact integers (۵٬۹۰۲٬۰۰۰ → 5 902 000 toman).
- Missing duration is derived and flagged; missing flight number stays `null`; baggage and
  refund stay unknown (never guessed).
- Cabin separates rows; the business row is not merged with economy.
- A stated stop count without intermediate airports yields `stops: 1` + `stops-partial`
  instead of fabricated segments.
- Every row gets a deterministic id (no provider id needed) and a display group key.

### 1.3 Amadeus parse + normalize (official-schema fixture)

```
AMADEUS offers=2 accepted=2 rejected=0
{ "flt": "TK-879", "priceMinor": 31245, "cur": "EUR", "comparable": false, "seats": 9,
  "bag": {"checked":"included","checkedKg":25}, "stops": 0,
  "warn": ["availability-unverified","price-foreign","refund-unknown","source-test-environment"] }
{ "flt": "QR-491", "priceMinor": 18510, "cur": "EUR", "comparable": false, "seats": 2,
  "bag": {"checked":"included","checkedKg":null}, "stops": 1 }
```

What this proves:

- Decimal strings → integer minor units exactly (312.45 → 31 245), never floats.
- Foreign price is **not** converted to toman (`toman: 0`, `comparable: false`).
- Test-environment data is labelled (`source-test-environment`) and the payload endpoint says `(test)`.
- Seat count is exposed only where Amadeus states it; a piece-based baggage allowance does
  not invent a kilogram figure.

### 1.4 Provider isolation and dedupe (two connectors, one deliberately failing)

```
sepehr360  ok=true  accepted=4 raw=4 latency=120
amadeus    ok=false error={code:"prohibited", httpStatus:403, retryable:false}
OFFERS 4  GROUPS 4  hasLive=true
GROUP KEYS: IS|~|2026-11-13|THR>MHD, IR|~|…, W5|~|…, CPN|~|…
```

- A `prohibited` (403) failure did **not** retry and did **not** affect the other provider.
- Each group holds one offer: offers without a flight number never merge with each other.

### 1.5 API surface (against a running server, demo mode)

```
GET /api/health        → 200 {"status":"degraded","mode":"demo",
                              "database":{"mode":"off",...},
                              "providers":[{"id":"sepehr360","configured":true,...}],
                              checks:{searchModeHint,databaseHint,amadeusHint}}
GET /api/live/search?origin=THR&destination=MHD&date=2026-11-20&mode=demo&persist=false
                       → 200 mode=demo offers=8 ranking={best,cheapest,fastest,weights}
                         persistence={attempted:false,reasonFa:"ذخیره‌سازی غیرفعال است"}
                         warnings=["demo-mode"]
GET /api/live/history?origin=THR&destination=MHD&range=30d
                       → 200 {available:false, reasonFa:"… به PostgreSQL نیاز دارد …"}
GET /live?origin=THR&destination=MHD&date=2026-11-20&mode=demo → 200, 7 offer cards rendered
GET /live/history?origin=THR&destination=MHD&range=7d          → 200
```

The demo path was also exercised end to end from the CLI:

```
npm run search:live -- THR MHD 2026-11-20 --demo
  حالت: demo | 7 نرخ | 39 ms
  رتبه‌بندی: بهترین=pars:thr-mhd-zv-652-2026-11-20 | …
  ذخیره‌سازی: ثبت نشد: دیتابیس پیکربندی نشده؛ تاریخچهٔ قیمت ثبت نمی‌شود
```

(Demo row count dropped 8 → 7 because intra-provider duplicates are now collapsed before
ranking, exactly as the live path does.)

### 1.6 Ranking core

- Demo ranking now **delegates** to the shared core (`src/modules/ranking/core.ts`), and the
  pre-existing 12 ranking tests + 11 grounding tests pass unchanged — the extraction did not
  change behaviour.
- 14 core tests cover determinism, tie-breaking by id, hard constraints, badge assignment
  (including multi-badge), and the three live-only factors keeping weights normalised at 1.

### 1.7 Persistence logic

Tested against a faithful in-memory model of the schema (no live Postgres available here):

- second write of the same `(providerId, offerKey)` updates the row (no duplicate);
- different fare keys stay separate rows;
- an observation is appended only on a price change or after a 6-hour heartbeat;
- transaction retries on `P2034` (deadlock) only, not on validation errors;
- a concurrent duplicate submit that loses the unique race resolves to `deduped: true`
  instead of surfacing an error;
- provider rows are created before offers (the foreign key that would otherwise break the
  very first live run).

---

## 2. Partial (implemented, but not provable in this sandbox)

| Area | State | Why it is partial |
| --- | --- | --- |
| Live HTTP against Sepehr360 | Code complete; robots gate, allowlist, 1 retry, rate limit, size cap all unit-tested against a stubbed `fetch` | Sandbox egress is allowlisted to npm/PyPI/GitHub. **Not run against the real site.** |
| Live HTTP against Amadeus (token, search, re-pricing) | Code complete; token exchange, response parsing, price-change and fare-gone paths tested with fixtures | No credentials, and egress blocked. |
| Postgres schema (`prisma/schema.prisma` v2) | Reviewed field by field against every write in `persistence/live-store.ts` | `prisma generate` needs `binaries.prisma.sh`, unreachable here → client types are a hand-written façade (`src/modules/db/client-types.ts`), real generated types apply after `npm run db:generate`. |
| Price-history chart | Rendered and tested (single point, multi point, empty; no interpolation) | Reads Postgres, which is not available here, so only the "unavailable" branch ran. |
| Playwright E2E | Config unchanged | Browser binaries cannot be downloaded here (known limitation); the jsdom journey + the new live UI tests cover the same components. |

---

## 3. Unavailable / honestly not done

- **Alibaba as a live source** — excluded by design (needs TLS impersonation / non-public API).
  No workaround was attempted. It remains a demo adapter.
- **Train offers** — untouched, as agreed (flight first).
- **Round-trip live search** — the live path is one-way only; requesting a return date is not
  silently ignored (the field is not sent), but the UI does not offer it yet.
- **Per-offer deep links for Sepehr360** — the source has none. The card links to the search
  page and says so; this is a source limitation, not an omission.
- **Amadeus availability as a purchase guarantee** — `numberOfBookableSeats` reflects the
  provider's view at fetch time, not a seat hold.

---

## 4. What the operator must run (copy-paste)

```powershell
# 1. Database (required for the live path / price history)
CREATE DATABASE torob_tickets;
$env:DATABASE_URL="postgresql://postgres:PASS@localhost:5432/torob_tickets?schema=public"
npm run db:generate
npm run db:push
npm run db:seed
npm run db:doctor            # expect: connection OK, six v2 tables present

# 2. Live mode
$env:TOROB_SEARCH_MODE="live"
npm run provider:check sepehr360
npm run search:live THR MHD 2026-11-20
npm run db:history -- THR MHD 2026-11-20

# 3. Optional: Amadeus (separate test/production keys)
$env:AMADEUS_ENV="test"
$env:AMADEUS_CLIENT_ID="…"
$env:AMADEUS_CLIENT_SECRET="…"
npm run provider:check amadeus THR IST 2026-11-20
```

Evidence to paste back (sanitised):

1. `provider:check sepehr360` output — HTTP status, latency, raw/accepted/rejected counts, the
   three normalized sample rows, and any `parse`/`prohibited` codes.
2. `search:live` output — per-provider report lines, offer count, freshness counts, and the
   persistence line (`searchId=…`).
3. `db:history` output — one block per fare identity with observation counts and the change %.
4. If something fails: the exact error code from the report (`parse` → markup changed,
   `prohibited` → access blocked, `timeout`/`network` → connectivity).

What to look for when judging the result:

- `raw > 0` but `accepted = 0` → the page still loads, but the parser no longer matches: run
  `npm run fixtures:refresh -- sepehr360 <ORO> <DEST> <date>` and diff the captured page.
- `prohibited` → the site refuses automated access. Correct behaviour is to stop, not to retry.
- `priceObservedAt` on every offer must be a real timestamp you can compare to your clock.
- In `/live/history`, a line must never mix economy and business, or two baggage conditions.

---

## 5. Corrections from the design review — where each one landed

| # | Correction | Implementation | Proven by |
| --- | --- | --- | --- |
| 1 | Amadeus independent; test/production separated; test data never "live" | `auth.ts` (separate env vars, no fallback), `adapter.ts` (env on every record), `source-test-environment` warning | `amadeus.test.ts` (config + labelling), §1.3 |
| 2 | History keyed by exact fare identity | `modules/live/offer-identity.ts` (`offerKey`), DB `offerKey` + `baggageSignature` + `ticketType` | `live-identity.test.ts` (10 assertions), §1.2 |
| 3 | PostgreSQL+Prisma mandatory for the live path | `dbMode()`, `/api/health` reports `degraded`, persistence reason surfaced in UI and CLI | §1.5, §1.7 |
| 4 | Re-verification via Flight Offers Price, or an honest status | `amadeus/verify.ts` + `verifyBatch`, `lastVerifiedAt`, UI shows «انجام نشده» | `amadeus-verify.test.ts` (6 tests) |
| 5 | Unique ids without `rawOfferId`; safe against duplicates | deterministic `${providerId}:${offerKey}`, upsert, unique race → dedupe, provider FK pre-seeded | `persistence.test.ts`, §1.7 |
| 6 | Charts per fare identity, ranges, no fabricated history | `history/price-history.ts`, series per `offerKey`, append-only observations with heartbeat, chart without interpolation | `price-history.test.ts`, `live-ui.dom.test.tsx`, §1.7 |
| 7 | Provider independence; demo/live separated in DB, API, UI | orchestrator isolation, `Provider.mode`, `dataSource`, `mode` in every payload, separate `/live` surface | §1.4, §1.5 |
| 8 | Compliance check before scraping; never circumvent | `HttpClient` robots gate + allowlist + no redirects + challenge detection; Alibaba excluded; rejected sources documented | `live-http.test.ts` (13 tests), `docs/COMPLIANCE.md` |
