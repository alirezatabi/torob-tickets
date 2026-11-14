# Continuous Safarmarket crawler

The website never performs a crawl as a side effect of a page view. `/crawl`, `/api/crawl`, health and search paths only read local snapshots/status. Continuous collection runs in the separate `crawl:worker` process.

## Operator-controlled setup

1. Use a persistent host or container with Node.js, this checkout, outbound access to Safarmarket, and a PostgreSQL database. A serverless web deployment is not a persistent worker and does not satisfy this setup.
2. Install and generate the database client, set up the schema, and provision `DATABASE_URL`:

   ```sh
   npm ci
   npm run db:generate
   npm run db:push
   ```

3. Supply an explicit list of real domestic airport pairs validated by your operator. The sample timetable in the app is not treated as verified route inventory:

   ```env
   CRAWLER_ENABLED=1
   CRAWLER_ROUTES=THR-MHD,THR-SYZ
   CRAWLER_INTERVAL_MINUTES=60
   CRAWLER_HORIZON_DAYS=1
   DATABASE_URL=postgresql://...
   ```

   Do not copy the example airport pairs without verifying they are the routes you intend to query. Route pairs are directional. The worker validates IATA-shaped codes only; it cannot prove route availability. The horizon is 1–14 departure days, default 1 (today in Asia/Tehran). The route-count × horizon combination is capped at 39 queries because the shared HTTP client has a 40-request ceiling including robots.txt. One complete sweep is performed every configured interval; the worker shares the polite per-host delay and robots cache across the sweep, never overlaps cycles, and waits until the next interval after a longer sweep finishes.

4. Run once interactively only when explicitly intended:

   ```sh
   CRAWLER_ENABLED=1 CRAWLER_ROUTES=THR-MHD DATABASE_URL=... npm run crawl:worker
   ```

5. For a persistent Linux host, adapt `deploy/torob-crawler.service` paths and service user, install it under `/etc/systemd/system/`, then use `systemctl enable --now torob-crawler`. Keep env secrets in a root-readable environment file, not Git. Worker status and raw snapshots are under ignored `data/crawl/` and should be backed up/retained according to your storage policy. PostgreSQL stores durable price history.

## Data and safety guarantees

- Safarmarket is the only enabled crawl source. Other source parsers are not invoked by this worker.
- Route inputs are operator-configured; there is no assumption that demo timetable routes are real.
- The worker uses existing HTTP controls: robots.txt checks, rate limiting, bounded retries, and it stops on challenge responses. It does not replay browser cookies/tokens/sessions or bypass a challenge. A denied robots policy, a challenge, or a source schema change is an operational failure, not a signal to circumvent the control.
- Raw Safarmarket amounts are treated as rial by the established adapter and converted once into toman. Hourly history stores the normalized toman value.
- Each normalized seller/fare identity is tracked separately by providerId + offerKey. A point is appended on any price change or when at least one hour has passed since the prior point. If prices are unchanged, the hourly point is still stored. History begins at the first actual observation; no past prices are inferred.
- File snapshots are latest values per source/route/departure date; PostgreSQL observations are the history of record. Use the existing `npm run db:history -- THR MHD [YYYY-MM-DD] [24h|7d|30d|90d|all]` report to inspect it.
- Web requests never start a crawl. Continuous operation is only guaranteed while the separate host process and PostgreSQL remain available; a paused/ephemeral serverless function is not sufficient.

Check `/crawl` for a fresh worker heartbeat and latest local snapshot status. Absence of status is not proof that no prior snapshots exist; it means the worker has no recent heartbeat at this deployment.
