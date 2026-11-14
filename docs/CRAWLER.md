# Crawler foundation (stage 1)

## Status

The crawler is **off by default**. No search page or browser/API request starts a crawl. `/crawl` and `/api/crawl` only read local snapshots; `POST /api/crawl` is rejected. A local operator must set `CRAWLER_ENABLED=1` and start an explicit CLI job. The current flight search still uses the existing demo dataset and the data badge continues to label it as demo.

The shared sandbox cannot reach the candidate sites, so no live probe result is claimed here. The user supplied a real Safarmarket DevTools JSON response excerpt, which is checked in as a sanitized fixture and supports a conservative response parser. Safarmarket is not yet an active search provider: its POST request body, price currency, and timezone semantics are not included/confirmed, so amounts remain unconverted and wall times remain local-only. The other four parser modules deliberately throw `NOT_IMPLEMENTED: نیاز به fixture واقعی`; do not replace them with guessed markup or remembered endpoints.

| Source | Parser | Status |
|---|---|---|
| Safarmarket | fixture-backed JSON response parser | endpoint observed; request body, price currency, timezone unresolved; blocked from network execution |

### Safarmarket fixture findings

Fixture: `tests/fixtures/crawl/safarmarket/THR-MHD-2026-11-22.json`. It is a sanitized excerpt of the owner-provided DevTools response: the response says `providersCount: 5`, but this excerpt contains only three provider rows, so the parser test's expected count is **3 excerpt offers**, not the total live result count.

- Envelope and nesting: numeric `code: 200` → `result.flights[]` → flight identity and `leave` → `leave.legs[0]` route/times → `providers[]` seller-specific prices.
- Quote fields observed: `providers[].price`, `title`, `titleEn`, `id`, `coreId`, `outboundCapacity`, `outBoundBaggages`, and `outBoundCancellationPolicies`. The parser emits one raw quote per captured provider row. Missing values remain `null`.
- Flight fields observed: `flightId`, `flightClass`, `leave.flightNo`, `airlineName`, `airlineCode`, `departureTime`, `arrivalTime`, `duration`, `stopsCount`, `sellType`, `capacity`; route IATA codes and leg facts are under `leave.legs[0]`.
- Price units: neither the fixture nor its fields state IRR or IRT. `price` is kept as the original numeric amount (for example `81840000`) and `currency` remains null. **No rial-to-toman conversion is justified by this fixture.** A response with an explicit unit label/documented unit is needed before conversion.
- Time/date: source strings are Gregorian-looking local wall times (`2026-11-22 14:20`), with no offset or timezone; no Jalali date field is present in the checked-in excerpt. Raw local strings are preserved as `departureLocal`/`arrivalLocal`; normalized instants stay null. A captured timezone contract or source evidence is needed to create UTC timestamps.
- Capacity is seller-specific `outboundCapacity` when present, then seller `capacity`, then flight `leave.capacity`; the source field and fallback are both retained as observed. `sellType` is preserved literally (`CHARTER` in the excerpt). Provider URLs were removed during fixture sanitization because their opaque booking/search identifiers were not needed for parsing, so `offerUrl` remains null.
- Request finding: the browser capture identified `POST https://safarmarket.com/api/flight/v3/search`; it did **not** include the POST JSON body in the checked-in fixture. `buildRequests(query)` records the observed endpoint and method but returns a blocked request with `body: null`; `runSource` refuses to send it. Required next evidence: the sanitized DevTools **Request Payload** for a representative one-way search, plus an explicit unit/timezone indicator if available. Do not include Cookie, Authorization, session tokens, or personal headers.
| Flightio | placeholder | needs real fixture |
| MrBilit | placeholder | needs real fixture |
| Alibaba | placeholder | needs real fixture |
| Flytoday | placeholder | needs real fixture |

## Safety and request policy

`src/crawler/http.ts` provides injectable fetch and clock/sleep for deterministic tests. It serializes requests per host, manually checks redirects (including destination robots.txt), requires robots.txt to load (fail-closed), obeys the most-specific Allow/Disallow prefix, has a minimum three-second host interval, honors the full Retry-After delay, uses a 20-second per-request timeout, retries transient failures at most three times, applies a default total request ceiling of 40, and uses a transparent research User-Agent. Detected challenge/access blocks throw `CHALLENGE_DETECTED` and are not retried. No login, captcha, mobile token, header forgery, or challenge bypass is implemented. A crawl is an explicit local operation only.

Raw fields are nullable. The conservative normalizer reports invalid facts instead of inferring values or converting currencies. No live offers enter the existing search or cheapest-price pipeline. The grouping boundary also scopes crawled offers separately from demo offers. Synthetic tests are marked `source: "synthetic-test"`, rejected by snapshot storage, and excluded from snapshot reads/UI.

## Local operator workflow

1. Confirm the site permits the intended public request. Supply a known public search URL template yourself; the repository intentionally does not guess search endpoints. Use `{route}` and `{date}` placeholders if the URL needs them:

   ```sh
   export CRAWL_URL_ALIBABA='https://www.alibaba.ir/known-public-search?route={route}&date={date}'
   ```

2. Probe, manually review the output, and note the result in this document. Probe uses a configured URL per source; the exact variable names are `CRAWL_URL_SAFARMARKET`, `CRAWL_URL_FLIGHTIO`, `CRAWL_URL_MRBILIT`, `CRAWL_URL_ALIBABA`, and `CRAWL_URL_FLYTODAY`. It will request robots.txt before the configured page.

   ```sh
   CRAWLER_ENABLED=1 npm run crawl:probe
   ```

   To append the report locally to this file, opt in with `CRAWL_PROBE_REPORT=1`; review/redact it before committing.

3. Capture one permitted public response. For a request you already made in DevTools (especially Safarmarket's POST), save the response body locally and use offline import; this does not make another request or require `CRAWLER_ENABLED`:

   ```sh
   npm run crawl:capture -- --source safarmarket --route THR-MHD --date 2026-11-22 --response-file .\\response.json
   ```

   This writes under `tests/fixtures/crawl/<source>/` and drops URL/redirect fields plus common token/cookie fields. For a configured public GET URL, the same command without `--response-file` requires `CRAWLER_ENABLED=1`, uses robots checks, and performs a network capture. Review the full response for personal/session data before committing; sanitization is not a guarantee.

4. For a source whose request builder is complete, parser is fixture-tested, and units/times are understood, run an explicit route/date job. The command writes `data/crawl/latest.json` as a source-keyed manifest (plus ignored per-source runtime snapshots); the root manifest is intentionally not ignored so the owner can review/commit it. In the current tree, Safarmarket is blocked until the missing request body is supplied, and the other four sources are placeholders, so no source can yet produce a live snapshot.

   ```sh
   CRAWLER_ENABLED=1 npm run crawl -- --source <id> --route THR-MHD --date YYYY-MM-DD
   ```

Never enable scheduled or request-triggered crawling until robots/policies, price units, dates, time zones, route identity and refresh behavior have been established from evidence.

Safarmarket's fixture-backed parser extracts provider-level raw quotes, but leaves currency and UTC instants unresolved and is not wired into search or the current GET-only crawl runner; the POST request payload was not supplied. The other four parsers still throw the required placeholder error. Capture saves a fixture for inspection; it does not itself create a snapshot. Production snapshots require a deliberate job with evidenced request construction and safe normalization. The snapshot store refuses `synthetic-test` data.

## Commands and verification

- `CRAWLER_ENABLED=1 npm run crawl -- --source <id> --route THR-MHD --date YYYY-MM-DD` — explicit local job; currently Safarmarket is blocked for missing POST body and the other sources remain placeholders.
- `npm run crawl:probe` — optional live, local-only status probe; requires per-source URL configuration, may fail due to network/site policy.
- `CRAWLER_ENABLED=1 npm run crawl:capture -- --source <id> --route THR-MHD --date YYYY-MM-DD` — save a sanitized capture for fixture review.
- `npm run typecheck && npm run lint && npm test && npm run build` — local project checks; tests must stay on mocked fetch and never access the network.

## Stage 2

For each candidate independently: collect a permitted real fixture, document robots and response behavior, manually validate/redact it, implement and test extraction against only that fixture, validate price/currency and timestamps, then explicitly review source quality and policy before considering a local crawl job. Keep unknown fields null and show provenance/freshness. Do not mix demo and crawled prices or label synthetic data as crawled.
