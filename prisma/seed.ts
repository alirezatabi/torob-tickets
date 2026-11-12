/**
 * Seed script (optional persistence).
 *
 * It runs the *real* aggregation pipeline for the curated demo dates and stores
 * the normalized offers, so the demo data in Postgres is byte-for-byte what the
 * app computes live — no separate fixture format to drift.
 *
 * Usage (Windows PowerShell, local Postgres — no Docker):
 *   $env:DATABASE_URL="postgresql://postgres:PASSWORD@localhost:5432/torob_tickets?schema=public"
 *   npm run db:generate   # writes src/generated/prisma (no engine download needed)
 *   npm run db:push
 *   npm run db:seed
 *
 * Prisma 7: the URL is never read from the schema — it comes from `prisma.config.ts` for
 * the CLI, and from a driver adapter for this script.
 */
import { PrismaClient, BaggageState, ProviderMode } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createQuery } from "../src/domain/trip";
import { runSearch } from "../src/providers/search";
import { listProviders } from "../src/providers/registry";
import { addDays, isoToday } from "../src/lib/jalali";
import { groupOffers } from "../src/dedupe/group";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error("DATABASE_URL تنظیم نشده است؛ برای seed به یک دیتابیس Postgres نیاز است.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const DEMO_ROUTES = [
  { originCode: "THR", destinationCode: "IST" },
  { originCode: "THR", destinationCode: "DXB" },
  { originCode: "THR", destinationCode: "MHD" },
  { originCode: "THR", destinationCode: "FRA" },
];

const DEMO_DAY_OFFSETS = [3, 7, 14, 21];

async function main() {
  console.log("→ seeding providers");
  await prisma.provider.deleteMany({ where: { mode: ProviderMode.LIVE } });
  for (const provider of listProviders()) {
    await prisma.provider.upsert({
      where: { id: provider.id },
      update: { name: provider.name, quotedCurrency: provider.quotedCurrency, lastSyncAt: new Date() },
      create: {
        id: provider.id,
        name: provider.name,
        mode: ProviderMode.DEMO,
        quotedCurrency: provider.quotedCurrency,
        lastSyncAt: new Date(),
      },
    });
  }

  const today = isoToday();
  let stored = 0;

  for (const route of DEMO_ROUTES) {
    for (const offset of DEMO_DAY_OFFSETS) {
      const departDate = addDays(today, offset);
      const query = createQuery({ ...route, departDate });
      const outcome = await runSearch(query);
      if (outcome.offers.length === 0) continue;

      await prisma.offerSnapshot.deleteMany({
        where: {
          originCode: route.originCode,
          destinationCode: route.destinationCode,
          departAt: {
            gte: new Date(`${departDate}T00:00:00.000Z`),
            lt: new Date(`${addDays(departDate, 1)}T00:00:00.000Z`),
          },
        },
      });

      await prisma.offerSnapshot.createMany({
        data: outcome.offers.map((offer) => ({
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
        })),
      });
      stored += outcome.offers.length;

      const groups = groupOffers(outcome.offers);
      const median = groups.map((group) => group.cheapestToman).sort((a, b) => a - b)[Math.floor(groups.length / 2)];
      if (median) {
        await prisma.routePriceStat.upsert({
          where: {
            originCode_destinationCode_monthIso: {
              originCode: route.originCode,
              destinationCode: route.destinationCode,
              monthIso: departDate.slice(0, 7),
            },
          },
          update: { medianToman: median, sampleCount: groups.length },
          create: {
            originCode: route.originCode,
            destinationCode: route.destinationCode,
            monthIso: departDate.slice(0, 7),
            medianToman: median,
            sampleCount: groups.length,
          },
        });
      }
    }
  }

  console.log(`✓ seeded ${stored} offer snapshots across ${DEMO_ROUTES.length} routes`);
}

main()
  .catch((error) => {
    console.error("seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
