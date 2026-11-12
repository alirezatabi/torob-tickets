# Sources: what is collectible, and how we decide

Two rules decide everything here:

1. **A price is only shown if it was actually read from a source** — never generated,
   never inferred from another source's number, never copied from a screenshot.
2. **A comparison is only between prices of the *same physical flight*** — carrier +
   flight number (+ route + date). See `src/dedupe/group.ts`.

If a source cannot be read honestly (login wall, CAPTCHA, JS-only client, undocumented
private API), we say so on screen instead of shipping a number that looks real.

## Status per source (verified 2026-11-12)

| Source | Public search page | Where the fares are | Status |
| --- | --- | --- | --- |
| **sepehr360.ir** | `GET /Flight/B2c/Search?origin=…&departureDate=…` (Jalali) | Server-rendered HTML — 20+ cards with price, airline logo/name, clocks, duration, seller line, and "فروش توسط N سایت مختلف" | **Working** (`Sepehr360Adapter`) |
| **mehrabgasht.ir** | Homepage + `Systems/FlightCheapestPriceBar.aspx?Origin=THR&Destination=MHD` (public, server-rendered) | The bar page lists **one cheapest fare per calendar day** for the route (price + date, no clock, no airline name outside a `flightNumber`/`fareName` deep link). Its own `api/DeepLink/...` endpoint answers **404** for direct calls. The per-flight search lives behind `Login.aspx` (عمومی/آژانس). | **Blocked**: no per-flight identity, no clock, search behind login. Deep links 404. |
| **pingotrip.com** | `pingotrip.com/flights/THR-MHD` | Client-rendered: the page body says «در حال پیدا کردن بهترین پروازها…» and no fare is in the HTML. Its own data endpoint is not published and was not guessed. | **Not readable without a browser**; probe needed |
| **alibaba.ir** | `alibaba.ir/flights/THR-MHD` | Client-rendered shell; the visible text is only the FAQ. `api/v1/flights/search` is **404** (wrong path; the real one is private). | **Not readable** without their private API |
| **flytoday.ir** | `flytoday.ir/flight/thr-mhd` | Client-rendered shell for a specific search, but the **homepage** carries real "پرواز به مقاصد پرطرفدار" fares (airline, times, route, price in ریال) — for *other* routes/dates. | **Partially readable** (homepage promos only); search page needs a probe |
| **Amadeus Self-Service** | Official API | Real API, but the test environment returns cached sample data and production needs keys | **Optional**, needs user keys |

**Why we do not scrape the "cheapest per day" bar and present it as a flight price:** it is
one number per day with no departure time and no flight number. Comparing it to a
`sepehr360` row would be comparing *different tickets* — exactly the confusion
`dedupe/group.ts` now makes impossible.

## Turning "not readable" into a working adapter

Run the probe from a machine with normal access (it is the only honest way to learn the
response shape):

```bash
npm run source:probe -- "https://www.flytoday.ir/flight/thr-mhd?departureDate=2026-11-20"
npm run source:probe -- "https://pingotrip.com/flights/THR-MHD" --save
```

The output has five sections — page status/size/title, how many price-like numbers the
**HTML itself** contains, embedded JSON blocks, the bundles and API-looking literals, the
same-URL JSON answer, and a full discovery pass with the key names of any payload found.
`--save` writes the raw body to `.provider-snapshots/` (git-ignored) so an adapter and its
fixtures can be built against a real response.

That single command decides the next step:

- **prices in the HTML** → an HTML adapter like `sepehr360/parser.ts` (content-driven, no
  class names);
- **JSON behind a header/endpoint** → extend `shared/api-discovery.ts`'s result with a
  per-source key map (like `sepehr360/json-mapper.ts`);
- **login/CAPTCHA** → the honest output is an "unavailable" status in the provider strip,
  not a fabricated price.

## Adding the next source

1. `npm run source:probe -- <url>` and keep its output with the fixture.
2. Implement `LiveProviderAdapter` (`src/modules/providers/contracts/provider.ts`) using
   `HttpClient` (allowlist + robots + rate limit) and `assembleLiveOffer`.
3. Declare capabilities truthfully. Two facts matter most for comparison:
   - **flight number** — without it, an offer can only be compared within its own source
     (`identity: "same-departure"`);
   - **seller count** — when a source says "N agencies sell this fare", that is a real
     market fact; set `sellerCount` so the card can show «۱۲۵ فروشنده» instead of «۱ منبع».
4. Register it in `registry-live.ts` and add a row to this table.
