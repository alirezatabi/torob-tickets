/**
 * Transaction helper with a bounded retry.
 *
 * Persisting a search writes four tables (search, fetch logs, offers, price
 * observations). A half-written search is worse than a failed one: the UI would show
 * offers whose history rows are missing. So every write goes through one interactive
 * transaction, retried only for genuinely concurrent failures (unique race, deadlock,
 * serialization) — never for validation errors.
 */

import type { Prisma } from "@prisma/client";

import { getPrisma } from "@/modules/db/prisma";
import { isRetryableDbError, mapPrismaError } from "@/modules/db/errors";

export interface TransactionOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  /** Injectable for tests: the client must expose `$transaction`. */
  client?: TransactionCapable;
}

/** The slice of PrismaClient we actually use, so tests can pass a fake. */
export interface TransactionCapable {
  $transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>, options?: { timeout?: number; maxWait?: number }): Promise<T>;
}

export async function withTransaction<T>(
  run: (tx: Prisma.TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const attempts = options.maxAttempts ?? 3;
  const timeout = options.timeoutMs ?? 10_000;
  const prisma = options.client ?? getPrisma();

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await prisma.$transaction(run, { timeout, maxWait: 5_000 });
    } catch (error) {
      lastError = mapPrismaError(error);
      if (attempt === attempts || !isRetryableDbError(error)) break;
      await new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.random() * 60));
    }
  }
  throw lastError ?? new Error("transaction failed");
}
