#!/usr/bin/env tsx
import "dotenv/config";
import { disconnectPrisma, getPrisma } from "../src/modules/db/prisma";

type DeleteWhere = {
  id?: { in: string[] };
  providerId?: { in: string[] };
  searchId?: { in: string[] };
  liveProviderId?: { in: string[] };
  mode?: "DEMO";
  OR?: DeleteWhere[];
};
interface CleanupTx {
  provider: {
    findMany(args: { where: { mode: "DEMO" }; select: { id: true } }): Promise<Array<{ id: string }>>;
    deleteMany(args: { where: { id: { in: string[] } } }): Promise<{ count: number }>;
  };
  offerSnapshot: { deleteMany(args: { where: { providerId: { in: string[] } } }): Promise<{ count: number }> };
  routePriceStat: { deleteMany(): Promise<{ count: number }> };
  liveProvider: {
    findMany(args: { where: { mode: "DEMO" }; select: { id: true } }): Promise<Array<{ id: string }>>;
    deleteMany(args: { where: { id: { in: string[] } } }): Promise<{ count: number }>;
  };
  flightSearch: {
    findMany(args: { where: { mode: "DEMO" }; select: { id: true } }): Promise<Array<{ id: string }>>;
    updateMany(args: { where: { id: { in: string[] } }; data: { liveProviderId: null } }): Promise<{ count: number }>;
    deleteMany(args: { where: { id: { in: string[] } } }): Promise<{ count: number }>;
  };
  providerFetchLog: { deleteMany(args: { where: DeleteWhere }): Promise<{ count: number }> };
  priceObservation: { deleteMany(args: { where: DeleteWhere }): Promise<{ count: number }> };
  flightOffer: { deleteMany(args: { where: DeleteWhere }): Promise<{ count: number }> };
  searchSnapshot: { deleteMany(args: { where: { mode: "DEMO" } }): Promise<{ count: number }> };
}
type CleanupDb = CleanupTx & {
  $transaction<T>(run: (tx: CleanupTx) => Promise<T>): Promise<T>;
};

async function main(): Promise<void> {
  if (process.env.CLEAR_DEMO_SEED !== "1") {
    throw new Error("حذف متوقف شد. برای تأیید صریح، CLEAR_DEMO_SEED=1 را فقط در همین اجرای دستور تنظیم کنید.");
  }

  const db = (await getPrisma()) as unknown as CleanupDb;
  const deleted = await db.$transaction(async (tx) => {
    const [legacyProviders, liveProviders, demoSearches] = await Promise.all([
      tx.provider.findMany({ where: { mode: "DEMO" }, select: { id: true } }),
      tx.liveProvider.findMany({ where: { mode: "DEMO" }, select: { id: true } }),
      tx.flightSearch.findMany({ where: { mode: "DEMO" }, select: { id: true } }),
    ]);
    const legacyIds = legacyProviders.map(({ id }) => id);
    const liveIds = liveProviders.map(({ id }) => id);
    const searchIds = demoSearches.map(({ id }) => id);
    const legacy = { providerId: { in: legacyIds } };
    const relatedToDemo = { OR: [{ providerId: { in: liveIds } }, { searchId: { in: searchIds } }] };

    // Clear dependent demo rows first; all LIVE rows and crawl files stay untouched.
    const observations = await tx.priceObservation.deleteMany({ where: relatedToDemo });
    const offers = await tx.flightOffer.deleteMany({ where: relatedToDemo });
    const logs = await tx.providerFetchLog.deleteMany({ where: relatedToDemo });
    const searchCaches = await tx.searchSnapshot.deleteMany({ where: { mode: "DEMO" } });
    await tx.flightSearch.updateMany({ where: { id: { in: searchIds } }, data: { liveProviderId: null } });
    const searches = await tx.flightSearch.deleteMany({ where: { id: { in: searchIds } } });
    const liveProviderRows = await tx.liveProvider.deleteMany({ where: { id: { in: liveIds } } });
    const legacySnapshots = await tx.offerSnapshot.deleteMany({ where: legacy });
    const routeStats = await tx.routePriceStat.deleteMany();
    const legacyProviderRows = await tx.provider.deleteMany({ where: { id: { in: legacyIds } } });

    return {
      legacySnapshots: legacySnapshots.count,
      routeStats: routeStats.count,
      offers: offers.count,
      observations: observations.count,
      logs: logs.count,
      searchCaches: searchCaches.count,
      searches: searches.count,
      liveProviders: liveProviderRows.count,
      legacyProviders: legacyProviderRows.count,
    };
  });

  console.log("ردیف‌های نمونه پاک شدند:", deleted);
  console.log("جست‌وجوها و تاریخچهٔ LIVE، SearchLog و فایل‌های محلی Safarmarket دست‌نخورده ماندند.");
}

main()
  .catch((error: unknown) => {
    console.error("پاک‌سازی انجام نشد:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    void disconnectPrisma();
  });
