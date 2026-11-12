/**
 * Prisma client singleton.
 *
 * Prisma 7 has two hard rules that shape this file:
 *   1. the connection URL lives in `prisma.config.ts` for the CLI, and at runtime it is
 *      passed to the client through a **driver adapter** (`@prisma/adapter-pg`);
 *   2. `PrismaClient` is generated into `src/generated/prisma` by `prisma generate`,
 *      which needs no engine binary — but it *is* required before the types exist.
 *
 * The demo path and the unit tests must stay runnable with no database and no generated
 * client, so this module never throws at import time: the generated client is loaded
 * lazily, and `getPrisma()` throws a typed `DatabaseUnavailableError` with a Persian,
 * actionable message instead.
 */

import type { TypedDb } from "@/modules/db/client-types";
import { DatabaseUnavailableError } from "@/modules/db/errors";

/** The slice of PrismaClient this app calls directly (see `db/client-types.ts`). */
type RuntimeClient = TypedDb & {
  $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  $disconnect: () => Promise<void>;
};

const globalForPrisma = globalThis as unknown as {
  __torobPrisma?: RuntimeClient;
};

let client: RuntimeClient | null = null;

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
 * Typed view of the client. The hand-written `TypedDb` façade keeps the project
 * typechecking before `db:generate` has ever run; once it has, the real generated
 * types satisfy the same interface at every call site.
 */
export async function getDb(): Promise<TypedDb> {
  return getPrisma();
}

/**
 * Async on purpose: the generated client is a runtime import (it does not exist until
 * `db:generate` runs), so it can only be resolved on an async path.
 */
export async function getPrisma(): Promise<RuntimeClient> {
  if (dbMode() === "off") {
    throw new DatabaseUnavailableError(
      "دیتابیس در دسترس نیست: برای مسیر واقعی، DATABASE_URL را تنظیم و `npm run db:push` را اجرا کنید.",
      isDatabaseConfigured() ? "TOROB_DB_MODE=off" : "DATABASE_URL is not set",
    );
  }
  if (!client) {
    client = globalForPrisma.__torobPrisma ?? (await createClient());
    globalForPrisma.__torobPrisma = client;
  }
  return client;
}

/**
 * Build the client with a Postgres driver adapter (required in Prisma 7) and a relative
 * import of the generated output, so a missing `db:generate` produces our own Persian
 * error instead of a bare module-resolution crash deep inside a page render.
 */
async function createClient(): Promise<RuntimeClient> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new DatabaseUnavailableError("دیتابیس پیکربندی نشده است.", "DATABASE_URL is empty");
  }

  let PrismaClient: new (options: { adapter: unknown; log?: string[] }) => RuntimeClient;
  let PrismaPg: new (options: { connectionString: string }) => unknown;
  try {
    // Both live in the ESM graph but only after `npm run db:generate`, so they are
    // loaded through non-literal specifiers: webpack leaves these as runtime imports
    // instead of failing the build when the generated folder does not exist yet
    // (that keeps the zero-config demo buildable and self-contained).
    const load = new Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<Record<string, unknown>>;
    const generated = await loadGeneratedClient(load);
    const adapterPkg = await load("@prisma/adapter-pg");
    PrismaClient = generated.PrismaClient as typeof PrismaClient;
    PrismaPg = adapterPkg.PrismaPg as typeof PrismaPg;
  } catch (error) {
    throw new DatabaseUnavailableError(
      "کلاینت دیتابیس ساخته نشده است: `npm run db:generate` را اجرا کنید.",
      error instanceof Error ? error.message : String(error),
    );
  }

  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

/**
 * The generated client sits at `src/generated/prisma/client.ts` (Prisma 7 `prisma-client`
 * generator). The alias resolves inside Next; plain Node/tsx runners need a file URL.
 */
async function loadGeneratedClient(
  load: (specifier: string) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  try {
    return await load("@/generated/prisma/client");
  } catch (aliasError) {
    const { pathToFileURL } = await import("node:url");
    const { join } = await import("node:path");
    const fileUrl = pathToFileURL(join(process.cwd(), "src/generated/prisma/client.ts")).href;
    try {
      return await load(fileUrl);
    } catch {
      throw aliasError;
    }
  }
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
    const prisma = await getPrisma();
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, message: "اتصال به PostgreSQL برقرار است" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
