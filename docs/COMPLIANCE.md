# Compliance & data-integrity rules

This document is the contract the code is held to. If a future change conflicts with
anything here, the change is wrong — not this file.

> **Scope note (current build).** The real-data layer has been removed on purpose: there is
> no HTTP client, no scraper, no provider key and no `TOROB_SEARCH_MODE`. Every number the
> app shows comes from the demo dataset in `src/lib/schedules.ts` + `src/providers/*`, and
> every screen says so. The rules below are kept because they still describe how that demo
> data is *represented* (and what must be true again if a real source is ever added back).

## 1. What we may and may not do

The app in this repository does **none** of the following — it makes no outbound request at
all. The table is the standing policy for any future connector.

| Allowed | Not allowed |
| --- | --- |
| One HTTPS GET per user search against a public, server-rendered results page | Crawling, pagination sweeps, or scheduled bulk scraping of a site |
| Reading `robots.txt` and honouring it | Working around a `Disallow` rule |
| Using an official, documented API with the operator's own key | Using undocumented endpoints as if they were stable |
| Sending a truthful `User-Agent` with a contact route | Impersonating a browser (TLS/header fingerprint spoofing) |
| Reporting a block/CAPTCHA as an error and stopping | Solving, outsourcing, or retrying a CAPTCHA |
| Caching responses in-process to reduce load | Distributed scraping with rotating IPs/proxies |

Consequences that outlived the removal of the connectors, and must hold in any future one:

- **Alibaba is excluded as a source.** Its internal `ws.alibaba.ir` endpoint requires TLS
  impersonation (a browser-fingerprint bypass), and its public API is contract-only. It
  remains a *demo* adapter with clearly labelled sample data.
- **No fabricated availability.** A seller that does not publish seat counts says
  "unknown"; the demo dataset states its own seat counts explicitly (see §2.6).
- **No "buy" link.** In this build no offer has a page anywhere, so no card renders an
  outbound link at all. The one action offered is "run this route/date as a search here".

## 2. Honesty rules (data integrity)

1. **No fabricated values.** Unknown facts are `null` / `"unknown"`, never a plausible
   default. Baggage is `unknown` unless stated. Refundability is `null` unless stated. A
   flight number is absent unless published.
2. **Money is integer.** Toman prices are integers (`BigInt` in Postgres). Rial→toman is
   `/10` with integer rounding, applied **once**, and disclosed (`price-converted`).
   Ambiguous unit combinations throw instead of guessing (`toTomanExact`).
3. **Foreign currency is not "converted".** A price in EUR/USD stays in EUR/USD with
   `price.comparable = false` and is excluded from toman rankings and history lines. No FX
   rate is invented.
4. **Duration is either stated or arithmetic.** If a source omits it, it is computed from
   departure/arrival and flagged `duration-inferred`.
5. **Freshness is a claim about the price, not the website.** `fresh` → `possibly-stale` →
   `unverified`, computed from `priceObservedAt`. Demo prices are labelled `demo` and are
   never described as fresh.
6. **Demo data never masquerades as live.** Every offer carries `dataSource: "demo"`, the
   search payload carries `mode: "demo"`, the database stores `mode = DEMO`, and the badge
   in the header is constant.
7. **One pricing rule.** The number on the card, the date-strip chip, the top suggestion
   and `/api/search` all come from `selectCheapestOffer`. If two surfaces disagree, that is
   a bug in the shared rule, not a rounding difference.

## 3. Identity rules (dedupe & history)

- **Price-history identity** = route (airports) + departure date + airline + flight number
  + cabin + fare class + baggage + ticket type. Encoded as `offerKey`
  (`src/modules/catalog/offer-identity.ts`).
  Consequence: a 30 kg fare and a hand-baggage-only fare for the *same* flight are two
  separate lines. They are never merged and never plotted together.
- **Display identity** = the same physical flight (airline + flight number + local day +
  route), encoded as `groupKey`. Different sellers of one flight collapse into one card.
- **Offers without a flight number never merge across providers** (they would be a guess);
  they are shown as separate rows.
- **Offer ids are derived**, not random: `${providerId}:${offerKey}`. Re-seeing a product
  updates one row (`upsert` on `(providerId, offerKey)`), so double submits and retries
  cannot create duplicates.

## 4. Failure rules

- A demo generator that throws is isolated: the search reports that provider as failed and
  still returns the other sellers' prices (`ProviderRunReport` with `ok: false`).
- A day with no flights yields `cheapestToman: null` and a 「—」 chip — never `۰`.
- A database failure never breaks a search: the payload reports `persistence.reasonFa` and
  still shows prices. Price history is an optional feature, not a prerequisite.

## 5. What is verified, and what is not

- **Verified by tests** (`npm test`, 26 files): money/unit conversion, offer identity,
  dedupe law, ranking, `selectCheapestOffer` and capacity, the 8-day strip and the Jalali
  calendar, local departure days, the four sorts, filtering, the LLM routes' limits, the
  UI's honesty labels, and the numbers in this README.
- **Not verified here:** end-to-end Playwright runs (the browser binary cannot be
  downloaded in this sandbox; the specs are written and listed) and any real provider
  connection (there is no connector to connect).

## 6. Secrets

- No `.env` file is committed; only `.env.example`, whose provider keys are all commented
  out and now irrelevant (there is no provider to authenticate to).
- The only secrets that could exist are `OPENAI_API_KEY` (optional LLM refinement) and
  `DATABASE_URL` (optional history). If either was ever shared, rotate it — the app throws
  nothing away when they are absent.
- Never print a key, a connection string or a full request URL with credentials in a log,
  an error message or a test snapshot.
