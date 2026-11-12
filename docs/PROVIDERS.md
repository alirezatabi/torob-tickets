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

## Which sources can be compared, and why

`docs/SOURCES.md` records, per source, *where* the fares actually are and what blocks them
(verified by hand). The short version: Sepehr360 is server-rendered and works today;
mehrabgasht exposes only one cheapest fare per day (no clock, no flight number) and its
per-flight search is behind a login; pingotrip, alibaba and flytoday are client-rendered
for a specific search. `npm run source:probe -- <url>` turns any of them into evidence with
one page fetch plus a few allowlisted follow-ups.

**The comparison rule that follows from this:** offers are grouped into a flight by carrier
+ flight number; only when *no* source published a number may two offers group, and then
only within 5 minutes of departure (`identity: "same-departure"`, labelled in the card).
A daily "cheapest price" bar is therefore *never* compared to a flight price.

**Where the comparison shows up:** `/live` rows are *flights*, not offers. Each row carries
`identity` (`flight-number`, or `same-departure` when no source published a number — labelled
on the card), `knownSellers` (agencies the source says carry this fare, e.g. «۱۲۵ فروشنده»)
and a per-source price list («همین پرواز، در هر منبعی که نرخش را دارد»). `providerCount` is
how many sources we actually hold a price from; it is never conflated with `knownSellers`.

To exercise the multi-source path on this machine (no second live source needed):

```bash
TOROB_SIMULATE_SECOND_SOURCE=1 TOROB_SEARCH_MODE=live npm run dev   # /live
```

It mirrors the first four real offers under a second provider id with a 3.5% spread — a
test-only switch, off by default, and the mirrored rows are labelled «منبع دوم (شبیه‌سازی)».

## Sepehr360

- Hosts: the publisher's own — `sepehr360.ir`, `www.`, `api.`, `cdn.` (its logos already
  come from the CDN). No other domain is reachable, and robots.txt is honoured on each.
- Endpoint: `GET https://sepehr360.ir/Flight/B2c/Search?origin=THR&destination=MHD&departureDate=1405-08-22`
  (`departureDate` is **Jalali**; a Gregorian date silently returns an empty list, so the
  URL builder converts and is unit-tested).
- Airline codes are taken from the logo URL the page prints (the site's own authority) and
  the printed Persian name is shown; both must agree in `src/modules/airlines/registry.ts`.
  Codes verified against the live page: `VR` وارش, `AXV` آوا, `MEH` مهر, `B9` ایران ایرتور,
  `A7` آسا جت, `NSN` نسیم ایر, `DZD` یزد ایر, `ATS` اطلس ایر, `J1` معراج, `TKN` فلای کیش,
  `FP` فلای پرشیا, `IS` سپهران, `NV` کارون, `IR` ایران ایر, `CPN` کاسپین, `I3` آتا,
  `QB` قشم ایر, `W5` ماهان. A code we cannot confirm stays `??` rather than being guessed.
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
  1b. **Same-URL JSON negotiation.** If the page is a single-page app, its own client asks
     *the very same URL* for JSON. One request with `Accept: application/json` (then an
     XHR-flavoured retry) answers the question without guessing any route.
  2. **The app's bundles as a roadmap.** Up to 2 same-host bundles are fetched — the app
     chunks, never `runtime`/`polyfills`/`vendor`/CSS, which cost 300 KB and never name an
     endpoint. Each quoted literal is judged **on its own text**, not on the URL it would
     resolve to (that is how `/Flight/B2c/gtm.start` once looked like an API route), ranked
     by how much it reads like a fares route, and tag-manager/analytics literals are dropped.
  2b. **Routes implied by the page's own layout.** With `/Flight/B2c/Search` and an API
     namespace visible in the site's asset paths (`/Flight/B2c/src/assets/…`), the
     `/Flight/B2c/api/search` family is probed last, still JSON-only, still
     shape-verified. Every probe asks for JSON; a probe that receives HTML is not counted.
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
  - `discovery=empty [spa=same-url-html] scripts=N json=N shapes=/path[keys…]` — whether the
    search URL only ever returned the app shell, how many bundles were read, how many
    endpoints answered JSON, and the key names of the payloads that did. This is the line to
    read before changing anything.
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

### Verifying against a mirror (no egress needed)

`SEPEHR360_BASE_URL` points the connector at a local copy of a real response. The host of
that URL is added to the connector's allowlist (plain http is allowed **only** for this
explicit operator override), so the documented hook actually works:

```bash
mkdir -p .mirror && cp <saved>.html .mirror/page.html   # git-ignored
node -e '...'                                          # serve it on :3210
SEPEHR360_BASE_URL=http://127.0.0.1:3210 TOROB_SEARCH_MODE=live npm run search:live THR MHD 2026-11-20
```

That run is the end-to-end proof path: page → parser → normalizer → ranking → UI.

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
