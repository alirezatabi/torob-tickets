/**
 * Seed an optional PostgreSQL database with a large, refreshable demo inventory.
 *
 * The in-app search works without PostgreSQL: `src/lib/schedules.ts` materializes the same
 * deterministic timetable for any route and date. This script preloads that inventory so
 * the database/history views have a useful 30-day range across every supported route.
 *
 * Usage:
 *   npm run db:generate && npm run db:push && npm run db:seed
 *   DEMO_SEED_DAYS=60 npm run db:seed
 */
import { PrismaClient, BaggageState, ProviderMode } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createQuery } from "../src/domain/trip";
import { runSearch } from "../src/providers/search";
import { listProviders } from "../src/providers/registry";
import { addDays, isoToday } from "../src/lib/jalali";
import { availableRoutes } from "../src/lib/schedules";
import { groupOffers } from "../src/dedupe/group";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error("DATABASE_URL تنظیم نشده است؛ برای seed به یک دیتابیس Postgres نیاز است.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const CHUNK_SIZE = 1_500;

function seedDays(): number {
  const requested = Number.parseInt(process.env.DEMO_SEED_DAYS ?? "30", 10);
  return Number.isFinite(requested) ? Math.min(120, Math.max(1, requested)) : 30;
}

function snapshotRow(offer: Awaited<ReturnType<typeof runSearch>>["offers"][number]) {
  return {
    providerId: offer.providerId,
    rawOfferId: offer.id.split(":")[1] ?? null,
    groupKey: offer.groupKey,
    airlineCode: offer.airlineCode,
    flightNumber: offer.flightNumber,
    originCode: offer.originCode,
    destinationCode: offer.destinationCode,
    departAt: new Date(offer.departAt),
    arriveAt: new Date(offer.arriveAt),
    durationMinutes: offer.durationMinutes,
    stops: offer.stops,
    priceToman: offer.price.toman,
    originalAmount: offer.price.original.amount,
    originalCurrency: offer.price.original.currency,
    baggageChecked:
      offer.baggage.checked === "included"
        ? BaggageState.INCLUDED
        : offer.baggage.checked === "not-included"
          ? BaggageState.NOT_INCLUDED
          : BaggageState.UNKNOWN,
    baggageCheckedKg: offer.baggage.checkedKg,
    refundable: offer.refundable,
    cabin: offer.cabin,
    offerUrl: offer.offerUrl,
    providerUpdatedAt: new Date(offer.providerUpdatedAt),
    fetchedAt: new Date(offer.fetchedAt),
    warnings: offer.warnings,
  };
}

async function main() {
  const providers = listProviders();
  const providerIds = providers.map((provider) => provider.id);
  const routes = availableRoutes();
  const days = seedDays();
  const today = isoToday();
  const now = new Date();

  console.log(`→ preparing ${providers.length} demo sellers across ${routes.length} routes and ${days} dates`);
  for (const provider of providers) {
    await prisma.provider.upsert({
      where: { id: provider.id },
      update: {
        name: provider.name,
        mode: ProviderMode.DEMO,
        quotedCurrency: provider.quotedCurrency,
        lastSyncAt: now,
      },
      create: {
        id: provider.id,
        name: provider.name,
        mode: ProviderMode.DEMO,
        quotedCurrency: provider.quotedCurrency,
        lastSyncAt: now,
      },
    });
  }

  // Rebuild only this demo inventory; other providers' rows are not touched.
  await prisma.offerSnapshot.deleteMany({ where: { providerId: { in: providerIds } } });
  await prisma.routePriceStat.deleteMany();

  let stored = 0;
  const routeMonthSamples = new Map<string, number[]>();
  for (let offset = 1; offset <= days; offset += 1) {
    const departDate = addDays(today, offset);
    const rows: ReturnType<typeof snapshotRow>[] = [];

    for (const route of routes) {
      const query = createQuery({ ...route, departDate });
      const outcome = await runSearch(query, { now });
      rows.push(...outcome.offers.map(snapshotRow));

      const sampleKey = `${route.originCode}|${route.destinationCode}|${departDate.slice(0, 7)}`;
      const samples = routeMonthSamples.get(sampleKey) ?? [];
      samples.push(...groupOffers(outcome.offers).map((group) => group.cheapestToman));
      routeMonthSamples.set(sampleKey, samples);
    }

    for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
      await prisma.offerSnapshot.createMany({ data: rows.slice(start, start + CHUNK_SIZE) });
    }
    stored += rows.length;
    if (offset % 5 === 0 || offset === days) {
      console.log(`  · ${offset}/${days} dates, ${stored.toLocaleString("en-US")} ticket quotes`);
    }
  }

  for (const [sampleKey, values] of routeMonthSamples) {
    if (!values.length) continue;
    const [originCode, destinationCode, monthIso] = sampleKey.split("|");
    if (!originCode || !destinationCode || !monthIso) continue;
    const sorted = [...values].sort((a, b) => a - b);
    const medianToman = sorted[Math.floor(sorted.length / 2)] ?? 0;
    await prisma.routePriceStat.upsert({
      where: { originCode_destinationCode_monthIso: { originCode, destinationCode, monthIso } },
      update: { medianToman, sampleCount: values.length },
      create: { originCode, destinationCode, monthIso, medianToman, sampleCount: values.length },
    });
  }

  console.log(`✓ seeded ${stored.toLocaleString("en-US")} sample ticket quotes across ${routes.length} routes and ${days} dates`);
}

main()
  .catch((error) => {
    console.error("seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
