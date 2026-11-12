# Providers

Two live sources, deliberately different in kind, plus the original demo dataset.

| | Sepehr360 | Amadeus Self-Service | Demo dataset |
| --- | --- | --- | --- |
| Kind | Public results page + the page's own JSON feed | Official REST API | Generated in-process |
| Credentials | none | OAuth2 client id/secret | none |
| Currency | تومان (integer) | EUR (decimal string) | تومان |
| Flight number | ✅ when the feed prints one (the HTML cards do not) | ✅ | ✅ |
| Segments / stops | stops only (no intermediate airports) | full segments | full segments |
| Baggage | ❌ | ✅ weight or piece count | ✅ |
| Refund terms | ❌ | ❌ | ✅ |
| Availability | ❌ | ✅ `numberOfBookableSeats` | ❌ |
| Per-offer deep link | ❌ (search page only) | ❌ (B2B API) | ❌ (in-app only) |
| "See at the source" | ✅ redirect → `/Flight/B2c/Search` | ❌ no public page | ❌ none (demo) |
| Price re-verification | ❌ | ✅ `POST /v1/shopping/flight-offers/pricing` | n/a |
| Freshness window | 5 min fresh / 20 min stale | 10 min fresh / 30 min stale | n/a (`demo`) |

Sepehr360 aggregates ~300 agencies. **That is one source**, not 300 — the count is never
inflated in the provider strip or in the docs.

## Sepehr360

- Endpoint: `GET https://sepehr360.ir/Flight/B2c/Search?origin=THR&destination=MHD&departureDate=1405-08-22`
  (`departureDate` is **Jalali**; a Gregorian date silently returns an empty list, so the
  URL builder converts and is unit-tested).
- Parser: content-driven (finds the smallest nodes containing both a price and a clock),
  not class-name-driven. It tolerates markup drift and reports warnings when it finds
  nothing, instead of pretending the route has no flights.
- Fields extracted: price, departure/arrival wall clock, duration (often empty),
  airline (logo URL + Persian name), cabin, stops, seller-aggregation label.
- Missing and therefore **not inferred**: flight number, aircraft, baggage, refund rules,
  availability, per-offer URL.
- Failure modes are explicit: `prohibited` for CAPTCHA/robots/redirect, `parse` when the
  page structure is no longer understood, empty-but-valid when the route has no flights.
- **The page is only a shell, so the adapter reads the feed the page itself reads.**
  `GET /Flight/B2c/Search` returns HTTP 200 with ~5 KB of markup that contains **no price
  and no clock** (`clues:price=0 clock=0`): the numbers arrive from the site's own XHR.
  Rather than tuning selectors against markup that never holds the data, or hard-coding a
  guessed endpoint, `src/modules/providers/shared/api-discovery.ts` does what a browser does,
  minus the browser:

  1. **Embedded JSON first.** If the document already ships the results
     (`<script type="application/json">`, `window.__STATE__ = {…}`), that is read with **no
     extra request**.
  2. **The page's bundles as a roadmap.** Up to 2 same-host `<script src>` bundles are
     fetched and scanned for quoted literals that look like API paths
     (`/(api|ws|v\d|flight|search)/`) on an allowlisted **https** host. The page's inline
     scripts are scanned too.
  3. **Bounded probing.** At most 3 candidates. Each is called **with the search the page
     carries** (`?origin=THR&destination=MHD&departureDate=1405-…`) — a fares API is
     meaningless without the question — and then bare.
  4. **One POST, only if nothing answered a GET with JSON.** The search is restated as a
     JSON body (`searchBody()`), for POST-only APIs.
  5. **Acceptance is a shape, not a hunch.** A payload is the offer feed only if it contains
     an array of objects that each carry a price-ish **and** a departure-ish **and** an
     arrival-ish key. Anything else is recorded as evidence and rejected.

  Discovery is bounded by a wall-clock budget (`DISCOVERY_BUDGET_MS`), the same allowlist,
  robots and token bucket as the page request (3 requests / 6 s for this source, i.e. a
  search plus at most two discovery calls). Mapping is **key-pattern** based, not name based
  (`sepehr360/json-mapper.ts`): a price must parse as money, a clock must be a real
  `hh:mm`, a code must be 2–3 alphanumerics, an airport must be 3 letters. Everything that
  does not fit stays `null` and surfaces as *unknown* in the UI — never as a fabricated
  number. A successful discovery appends `api-endpoint:<url>` to the run's warnings, which
  `search:live` prints, so every displayed price has a traceable origin.

- **An empty page is diagnosed, not guessed.** When nothing parses *and* discovery finds no
  offers, the failure carries both the diagnosis and what discovery saw, in
  `ProviderRunReport.error.summaryFa` (so it shows up in `provider:check`, `search:live` and
  the live UI):
  - `discovery=empty scripts=N json=N shapes=/path[keys…]` — how many bundles were read, how
    many endpoints answered JSON, and the key names of the payloads that did. This is the
    line to read before changing anything.
  - `results-require-js` — the page is a shell and the feed was not reachable (bundles
    blocked, endpoint behind a wall). *This is the honest answer when a public results page
    stops being server-rendered.*
  - `markup-changed` — result cards exist but none of our field patterns matched.
  - `unknown-page` — neither of the above.

  Getting a real fixture to fix the parser against (opt-in, one request, git-ignored output):

  ```bash
  npm run provider:check sepehr360 THR MHD 2026-11-19 -- --save-html
  # raw response → .provider-snapshots/<timestamp>-THR_MHD.html
  ```

  Without `--save-html`, an empty parse only writes a **sanitized** snapshot (title,
  headings, a few short numeric snippets) — no raw HTML is ever stored by default.

### Redirect to the source

A live Sepehr360 card renders **دیدن در سپهر۳۶۰**, whose `href` is our own hop:

```
/api/go/sepehr360?origin=THR&destination=MHD&date=2026-11-20&time=04:00&airline=IR
   → 302 → https://sepehr360.ir/Flight/B2c/Search?origin=THR&destination=MHD&departureDate=1405-08-29&departureTime=04:00&airline=IR
```

- The destination is **rebuilt server-side** from validated city codes + date (with the
  Jalali conversion), so a request parameter can never inject a host, and malformed links
  fall back to `/live` instead of an error page.
- `departureTime` / `airline` are context only — the site does not filter on them, and the
  UI says so: *«لینک، صفحهٔ جست‌وجوی منبع است، نه همین نرخ.»* We do not pretend this is a
  per-fare deep link, because no such URL exists.
- Each click writes one log line (`[redirect] provider=… route=… date=…`) and is sent with
  `cache-control: no-store`.
- Demo offers get no external link at all — the button becomes an in-app
  «همین مسیر در مقایسه» instead. (`src/modules/live/source-link.ts` is the single gate;
  `tests/unit/source-link.test.ts` and `tests/unit/redirect-route.test.ts` pin it.)

## Amadeus Self-Service

- Endpoints: `POST /v1/security/oauth2/token`, `GET /v2/shopping/flight-offers`,
  `POST /v1/shopping/flight-offers/pricing`.
- Hosts: `test.api.amadeus.com` (test) and `api.amadeus.com` (production). Credentials for
  the two environments are read from **different variables** with no fallback.
- Test environment returns **cached sample data**; it is labelled everywhere and never
  presented as a live price.
- Prices are foreign currency. They are stored as integer minor units with the original
  currency and marked `comparable: false` — no FX conversion, no toman ranking, no history
  line mixed with Iranian prices.
- Re-pricing (`verifyOffer`) distinguishes "price changed" (a normal event) from "fare no
  longer available" (the offer is gone). When verification is not possible, the UI shows
  `تأیید مجدد: انجام نشده` instead of a green check.

## Adding a provider

1. Implement `LiveProviderAdapter<TRaw>` (`src/modules/providers/contracts/provider.ts`):
   declare `capabilities` **truthfully** — they gate cross-provider merging and UI claims.
2. Reuse `HttpClient` (allowlist + robots + retries + rate limit), `assembleLiveOffer`
   (money, identity, freshness) and `buildForeignPrice`/`buildIranianPrice`.
3. Add fixtures captured from a real response; never call the site from tests.
4. Register it in `src/modules/providers/registry-live.ts` and add a line to this table.
5. Add it to `describeLiveProviders()`'s `missingFactsFa` so the UI states its gaps.
