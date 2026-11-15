/**
 * Demo inventory seeding is disabled. The product serves only real Safarmarket snapshots;
 * this script intentionally writes nothing to PostgreSQL.
 *
 * Remove historical demo seed rows with `npm run db:clear-demo-seed` instead.
 */
console.error("Seed دادهٔ نمونه غیرفعال است؛ این نسخه فقط snapshotهای واقعی Safarmarket را نمایش می‌دهد.");
console.error("برای پاک‌کردن seedهای قبلی: CLEAR_DEMO_SEED=1 npm run db:clear-demo-seed");
process.exitCode = 1;
