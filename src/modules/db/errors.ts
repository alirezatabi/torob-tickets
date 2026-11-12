/**
 * Database errors, translated into something a Persian-speaking operator can act on.
 *
 * Every message names the *cause* and the *fix*; a raw Prisma stack trace ("P2002:
 * Unique constraint failed") is useless in the UI and leaks internals.
 */

export type DbErrorCode =
  | "unavailable"
  | "unique-conflict"
  | "foreign-key"
  | "not-found"
  | "validation"
  | "timeout"
  | "transaction"
  | "unknown";

export class DatabaseUnavailableError extends Error {
  readonly code = "unavailable" as const;
  constructor(
    readonly summaryFa: string,
    readonly detail: string,
  ) {
    super(summaryFa);
    this.name = "DatabaseUnavailableError";
  }
}

export class DatabaseError extends Error {
  constructor(
    readonly code: DbErrorCode,
    readonly summaryFa: string,
    readonly detail: string,
    readonly retryable = false,
  ) {
    super(summaryFa);
    this.name = "DatabaseError";
  }
}

/** Map a Prisma error to our taxonomy. Safe for unknown inputs. */
export function mapPrismaError(error: unknown): DatabaseError | DatabaseUnavailableError {
  if (error instanceof DatabaseError || error instanceof DatabaseUnavailableError) return error;

  const code =
    typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  switch (code) {
    case "P2002":
      return new DatabaseError("unique-conflict", "این رکورد قبلاً ثبت شده است", detail, true);
    case "P2003":
      return new DatabaseError("foreign-key", "ارجاع به رکوردی که وجود ندارد", detail, false);
    case "P2025":
      return new DatabaseError("not-found", "رکورد مورد نظر پیدا نشد", detail, false);
    case "P2000":
    case "P2006":
    case "P2011":
      return new DatabaseError("validation", "دادهٔ نامعتبر برای ذخیره‌سازی", detail, false);
    case "P2024":
      return new DatabaseError("timeout", "اتصال به دیتابیس زمان‌بر شد", detail, true);
    case "P2034":
      return new DatabaseError("transaction", "تضاد هم‌زمانی در تراکنش پیش آمد", detail, true);
    default:
      break;
  }

  if (/connect|ECONNREFUSED|ENOTFOUND|authentication failed|does not exist/i.test(detail)) {
    return new DatabaseUnavailableError(
      "اتصال به PostgreSQL برقرار نشد؛ بررسی کنید سرویس در حال اجرا و DATABASE_URL درست باشد.",
      detail,
    );
  }

  return new DatabaseError("unknown", "خطای غیرمنتظره در دیتابیس", detail, false);
}

/** True for errors worth retrying once (unique races and deadlocks). */
export function isRetryableDbError(error: unknown): boolean {
  const mapped = mapPrismaError(error);
  return mapped instanceof DatabaseError && mapped.retryable;
}
