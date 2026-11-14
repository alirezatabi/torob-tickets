#!/usr/bin/env tsx
import "dotenv/config";
import { disconnectPrisma, getPrisma } from "../src/modules/db/prisma";

type DemoSeedDb = {
  provider: {
    findMany(args: { where: { mode: "DEMO" }; select: { id: true } }): Promise<Array<{ id: string }>>;
  };
  offerSnapshot: {
    count(args: { where: { providerId: { in: string[] } } }): Promise<number>;
    deleteMany(args: { where: { providerId: { in: string[] } } }): Promise<{ count: number }>;
  };
  routePriceStat: {
    count(): Promise<number>;
    deleteMany(): Promise<{ count: number }>;
  };
};

async function main(): Promise<void> {
  if (process.env.CLEAR_DEMO_SEED !== "1") {
    throw new Error("حذف متوقف شد. برای تأیید صریح، CLEAR_DEMO_SEED=1 را فقط در همین اجرای دستور تنظیم کنید.");
  }

  const db = (await getPrisma()) as unknown as DemoSeedDb;
  const demoProviders = await db.provider.findMany({ where: { mode: "DEMO" }, select: { id: true } });
  const providerIds = demoProviders.map(({ id }) => id);
  const offerWhere = { providerId: { in: providerIds } };
  const [snapshotCount, routeStatCount] = await Promise.all([
    db.offerSnapshot.count({ where: offerWhere }),
    db.routePriceStat.count(),
  ]);

  console.log(`ردیف بلیت نمونه برای پاک‌سازی: ${snapshotCount}`);
  console.log(`آمار مسیر نمونه برای پاک‌سازی: ${routeStatCount}`);
  if (snapshotCount === 0 && routeStatCount === 0) {
    console.log("دادهٔ seed نمونه‌ای برای حذف وجود ندارد.");
    return;
  }

  const deletedSnapshots = await db.offerSnapshot.deleteMany({ where: offerWhere });
  const deletedRouteStats = await db.routePriceStat.deleteMany();
  console.log(`پاک شد: ${deletedSnapshots.count} snapshot بلیت و ${deletedRouteStats.count} آمار مسیر نمونه.`);
  console.log("جست‌وجوها، observationهای تاریخچه، داده‌های Live و فایل‌های محلی crawl دست‌نخورده ماندند.");
}

main()
  .catch((error: unknown) => {
    console.error("پاک‌سازی انجام نشد:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    void disconnectPrisma();
  });
