/**
 * Prisma client singleton.
 *
 * The live path requires PostgreSQL (correction #3): price history must not depend on
 * an optional store. But the *demo* path and the unit tests must stay runnable with
 * no database at all, so this module never throws at import time — callers ask
 * `getDbStatus()` and decide. `getPrisma()` throws a typed `DatabaseUnavailableError`
 * with a Persian, actionable message.
 */

import { PrismaClient } from "@prisma/client";

import { DatabaseUnavailableError } from "@/modules/db/errors";
import type { TypedDb } from "@/modules/db/client-types";

export type DbRole = "runtime";

const globalForPrisma = globalThis as unknown as {
  __torobPrisma?: PrismaClient;
};

let client: PrismaClient | null = null;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0);
}

/**
 * Whether the live path is allowed to run right now.
 * `TOROB_DB_MODE=off` is an explicit offline switch for development; anything else
 * with a DATABASE_URL means "use Postgres".
 */
export function dbMode(): "postgres" | "off" {
  if (process.env.TOROB_DB_MODE === "off") return "off";
  return isDatabaseConfigured() ? "postgres" : "off";
}

/**
 * Typed view of the client. After `npm run db:generate` the real `PrismaClient`
 * satisfies `TypedDb`; before generation (CI without engine binaries) this keeps the
 * project typechecking without importing non-existent generated types.
 */
export function getDb(): TypedDb {
  return getPrisma() as unknown as TypedDb;
}

export function getPrisma(): PrismaClient {
  if (dbMode() === "off") {
    throw new DatabaseUnavailableError(
      "دیتابیس در دسترس نیست: برای مسیر واقعی، DATABASE_URL را تنظیم و `npm run db:push` را اجرا کنید.",
      isDatabaseConfigured() ? "TOROB_DB_MODE=off" : "DATABASE_URL is not set",
    );
  }
  if (!client) {
    client =
      globalForPrisma.__torobPrisma ??
      new PrismaClient({
        log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
      });
    globalForPrisma.__torobPrisma = client;
  }
  return client;
}

/** Test/CLI helper: close the pool so a script can exit. */
export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
    globalForPrisma.__torobPrisma = undefined;
  }
}

/** Cheap liveness probe used by `/api/health` and `scripts/doctor`. */
export async function checkDatabase(): Promise<{ ok: boolean; message: string }> {
  if (dbMode() === "off") {
    return { ok: false, message: "دیتابیس پیکربندی نشده است (DATABASE_URL یا TOROB_DB_MODE=off)" };
  }
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return { ok: true, message: "اتصال به PostgreSQL برقرار است" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
