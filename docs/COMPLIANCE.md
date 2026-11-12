# Compliance & data-integrity rules

This document is the contract the code is held to. If a future change conflicts with
anything here, the change is wrong — not this file.

## 1. What we may and may not do

| Allowed | Not allowed |
| --- | --- |
| One HTTPS GET per user search against a public, server-rendered results page | Crawling, pagination sweeps, or scheduled bulk scraping of a site |
| Reading `robots.txt` and honouring it (implemented in `HttpClient`) | Working around a `Disallow` rule |
| Using an official, documented API with the operator's own key | Using undocumented endpoints as if they were stable |
| Sending a truthful `User-Agent` with a contact route | Impersonating a browser (TLS/header fingerprint spoofing) |
| Reporting a block/CAPTCHA as an error and stopping | Solving, outsourcing, or retrying a CAPTCHA |
| Caching responses in-process to reduce load | Distributed scraping with rotating IPs/proxies |

Concrete consequences in this repo:

- **Alibaba is excluded.** Its internal `ws.alibaba.ir` endpoint requires TLS
  impersonation (a browser-fingerprint bypass). Their public API is contract-only with
  no self-serve access. Neither is acceptable, so Alibaba is **not** a live provider.
  It remains a *demo* adapter (clearly labelled sample data).
- **Sepehr360 is used read-only**: `GET /Flight/B2c/Search?origin=&destination=&departureDate=`
  exactly once per search, with a token bucket (2 requests / 6 s) and a 90 s result cache.
  Its `robots.txt` disallows only `/systemuser`, `/controlpanel`, `/core`; the search path
  is not disallowed — and the client re-checks at runtime instead of assuming.
- **Rejected second sources** (documented, not silently dropped):
  `flytoday.ir` (`Disallow: /*/search?*`), `snapptrip.com` (`Disallow: *?`),
  `charter724.com` (domain now serves `kish4.ir`). None of them were worked around.

## 2. Honesty rules (data integrity)

1. **No fabricated values.** Unknown facts are `null` / `"unknown"`, never a plausible
   default. Baggage is `unknown` unless the source states it. Refundability is `null`
   unless stated. A flight number is absent unless published.
2. **Money is integer.** Toman prices are integers (`BigInt` in Postgres). Rial→toman is
   `/10` with integer rounding, applied **once**, and disclosed (`price-converted`).
   Ambiguous unit combinations throw instead of guessing (`toTomanExact`).
3. **Foreign currency is not "converted".** Amadeus prices stay in EUR/USD with
   `price.comparable = false` and are excluded from toman rankings and history lines.
   No FX rate is invented.
4. **Duration is either stated or arithmetic.** If the source omits it, it is computed
   from departure/arrival and flagged `duration-inferred`.
5. **Freshness is a claim about the price, not the website.** `fresh` → `possibly-stale`
   → `unverified`, per provider policy, computed from `priceObservedAt`.
   Availability is claimed only when the source states it (`numberOfBookableSeats > 0`).
6. **Demo data never masquerades as live.** Every offer carries `dataSource`, every
   provider has a `mode` (`LIVE`/`DEMO`) stored in the DB, and the UI badge changes with
   the mode.
7. **Amadeus test ≠ production.** Separate env vars, separate hosts, and test responses
   are labelled in the API payload and on every card.

## 3. Identity rules (dedupe & history)

- **Price-history identity** = route (airports) + departure date + airline + flight number
  + cabin + fare class + baggage + ticket type. Encoded as `offerKey`.
  Consequence: a 30 kg fare and a hand-baggage-only fare for the *same* flight are two
  separate lines. They are never merged and never plotted together.
- **Display identity** = the same physical flight (airline + flight number + local day +
  route), encoded as `groupKey`. Different sellers of one flight collapse into one card.
- **Offers without a flight number never merge across providers** (they would be a guess);
  they are shown as separate rows.
- **Offer ids are derived**, not random: `${providerId}:${offerKey}`. Re-seeing a product
  updates one row (`upsert` on `(providerId, offerKey)`), so double submits, retries and
  cache misses cannot create duplicates.

## 4. Failure rules

- One provider's failure **never** blocks another: the orchestrator converts every throw
  into a `ProviderRunReport` with a taxonomy code (`timeout`, `network`, `http-4xx`,
  `http-5xx`, `rate-limited`, `prohibited`, `parse`, `schema`, `not-configured`,
  `coverage`).
- Retries: **once**, and only for `timeout` / `network` / `http-5xx` / `429`.
  `prohibited` (403, CAPTCHA, robots, redirect-to-login) is **never retried**.
- A parser that finds nothing while the page declares results fails loudly (`parse`)
  instead of returning "no flights".
- A database failure never breaks a search: the payload reports
  `persistence.reasonFa` and still shows prices.

## 5. What is verified, and what is not

Verified **in this environment** (fixtures + unit tests, no live calls):

- Sepehr360 parser against a captured real page shape (4 cards → 4 offers, Persian digits,
  Persian separators, empty duration, CAPTCHA page, empty page).
- Amadeus response parsing against official-schema fixtures (offers, errors-only payload,
  re-pricing success/price-change/unavailable).
- Money, identity, dedupe, orchestration isolation, concurrency cap, persistence
  invariants, ranking determinism — 250+ unit tests.

Verified **only on the operator's machine** (network egress is blocked in the build
sandbox):

- `npm run provider:check sepehr360` — a real HTTP round-trip and parse.
- `npm run search:live THR MHD <date>` — end-to-end search, ranking and persistence.
- `npm run db:doctor` / `npm run db:history` — Postgres schema and history reads.

Anything in the second list that has not been run must be reported as *unverified*, not
as "working".
