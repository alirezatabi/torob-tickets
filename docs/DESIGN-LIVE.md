# Live data pipeline — design

How a user search becomes a ranked, persisted, honest set of prices. This is the
architectural record for the live upgrade; the demo pipeline is unchanged and still runs
on the same ranking core.

```
 UI (/live, /search)            API (/api/live/*, /api/health)
        │                                   │
        └──────────────► server/live-search ◄┘
                                │
                    ┌───────────┴────────────┐
                    │  SearchOrchestrator    │  concurrency 2, per-provider budget
                    │  (isolation, cache)    │  90 s TTL cache, 1 search = 1 provider call
                    └───────────┬────────────┘
              ┌─────────────────┴──────────────────┐
        Sepehr360Adapter                     AmadeusAdapter
   HttpClient (allowlist, robots,        HttpClient + OAuth2 token cache
   1 retry, token bucket, size cap)      (test/production keys separated)
              │                                    │
        parser (content-driven)              parse (official schema)
              └─────────────────┬──────────────────┘
                        assembleLiveOffer
             (money, identity, freshness, completeness)
                                │
                    dedupeSameOffer  (intra-provider)
                                │
                    groupOffers      (cross-provider, display identity)
                                │
                    rankAndDecide    (one deterministic core)
                                │
          ┌─────────────────────┴─────────────────────┐
   response payload (evidence + badges)      persistSearch (one transaction)
```

## Key decisions

### One scorer, two data shapes
`src/modules/ranking/core.ts` scores `RankInput`, and both demo offers and live rows are
*projected* onto it (`project.ts`). Demo ranking now delegates to it, and the original 12
ranking tests pass unchanged — which is the proof that the extraction was behaviour-preserving.

Live data has three extra factors (freshness, completeness, seller competition). They are
**additive and small** (0.04 / 0.03 / 0.03): when at least one live offer is present, the
demo weights are rescaled by `1 - 0.10` so the total stays 1. A demo-only ranking therefore
scores bit-for-bit as before, and a live offer cannot win merely by being live.

### Identity is the spine
- `offerKey` (fare-level) → price history, DB uniqueness, deterministic ids.
- `groupKey` (display) → one card per physical flight, several sellers.
An offer with no flight number never merges across providers — a merge there would be a
guess, and a wrong merge is worse than a duplicate card.

### Money
Integers everywhere. Toman prices are `number` in memory, `BigInt` in Postgres. Rial→toman
is divided by 10 once and flagged. Foreign currency keeps its own unit with
`comparable: false`; it is never converted with an invented FX rate, and it therefore never
enters a toman ranking or a toman price-history line.

### Freshness is a price claim, not a site claim
Each provider declares `freshMs` / `staleMs`. The state is computed from
`priceObservedAt` at read time (`fresh` → `possibly-stale` → `unverified`). Availability is
claimed only when the source states it — in practice: Amadeus, and only with
`numberOfBookableSeats > 0`. Sepehr360 can never claim availability, and its UI note says so.

### Persistence: idempotent, transactional, evidence-carrying
One interactive transaction writes: provider rows (FK safety) → search → per-provider fetch
logs → offers (`upsert` on `(providerId, offerKey)`) → observations. A unique race on
`(requestHash, startedAt)` resolves to `deduped: true` rather than an error. Observations are
append-only and written only when the price changes or a 6-hour heartbeat elapses, so a
refreshed page does not fabricate a dense history.

A DB failure is **never fatal**: the payload reports `persistence.reasonFa` and the prices are
still returned.

### Evidence over assertions
`ProviderRunReport` (ok, accepted, rejected, raw, latency, retries, error code) is returned by
the API, printed by `search:live`, stored in `provider_fetch_logs`, and summarised in
`/api/health`. "It works" is always a claim with a number attached.

## Failure matrix

| Situation | Behaviour | Code |
| --- | --- | --- |
| Source times out | 1 retry, then the other provider still answers | `timeout` (retryable) |
| 403 / CAPTCHA / login redirect | No retry, provider marked failed | `prohibited` (never retried) |
| `robots.txt` disallows the path | Request never sent | `prohibited` |
| 5xx | 1 retry, then failed | `http-5xx` |
| Markup changed (0 cards, results declared) | Failed loudly, not "no flights" | `parse` |
| Route genuinely has no offers | Empty success + explicit empty state | — |
| Postgres down/absent | Prices still shown, history reported unavailable | `persistence.reasonFa` |
| Amadeus unconfigured | Provider listed as not configured, never called | `not-configured` |
| Amadeus fare gone at re-price | Offer shown with a verification note | `unavailable` |

## Deliberate non-goals

- No crawling, pagination sweeps, or background scraping jobs.
- No CAPTCHA solving, browser-fingerprint impersonation, or proxy rotation.
- No invented FX rate, no invented baggage/refund facts, no backfilled history.
- No booking: there are no fake booking buttons, and links go to the source (or say they
  cannot).
