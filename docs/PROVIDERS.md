# Providers

Two live sources, deliberately different in kind, plus the original demo dataset.

| | Sepehr360 | Amadeus Self-Service | Demo dataset |
| --- | --- | --- | --- |
| Kind | Public HTML results page | Official REST API | Generated in-process |
| Credentials | none | OAuth2 client id/secret | none |
| Currency | تومان (integer) | EUR (decimal string) | تومان |
| Flight number | ❌ | ✅ | ✅ |
| Segments / stops | stops only (no intermediate airports) | full segments | full segments |
| Baggage | ❌ | ✅ weight or piece count | ✅ |
| Refund terms | ❌ | ❌ | ✅ |
| Availability | ❌ | ✅ `numberOfBookableSeats` | ❌ |
| Per-offer deep link | ❌ (search page only) | ❌ (B2B API) | ✅ (demo URL) |
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
- **An empty page is diagnosed, not guessed.** When nothing parses, the adapter inspects
  the response and reports one of three causes, in `ProviderRunReport.error.summaryFa`
  (so it shows up in `provider:check`, `search:live` and the live UI):
  - `results-require-js` — the page is a shell; the numbers arrive from the site's own XHR,
    so an HTML parser will never see them. *This is the honest answer when a public
    results page stops being server-rendered.*
  - `markup-changed` — result cards exist but none of our field patterns matched.
  - `unknown-page` — neither of the above.

  Getting a real fixture to fix the parser against (opt-in, one request, git-ignored output):

  ```bash
  npm run provider:check sepehr360 THR MHD 2026-11-19 -- --save-html
  # raw response → .provider-snapshots/<timestamp>-THR_MHD.html
  ```

  Without `--save-html`, an empty parse only writes a **sanitized** snapshot (title,
  headings, a few short numeric snippets) — no raw HTML is ever stored by default.

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
