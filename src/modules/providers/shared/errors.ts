/**
 * Provider error taxonomy.
 *
 * The orchestrator decides what to do based on this type, never on message text:
 *   • retryable errors are retried once with a short backoff;
 *   • `prohibited` (403, CAPTCHA, robots violation, login wall) is NEVER retried —
 *     retrying an intentional block is an attempt to bypass it.
 */
export type ProviderErrorCode =
  | "timeout"
  | "network"
  | "http-4xx"
  | "http-5xx"
  | "rate-limited"
  | "prohibited"
  | "parse"
  | "schema"
  | "not-configured"
  | "coverage";

export interface ProviderErrorInfo {
  code: ProviderErrorCode;
  /** Short, user-safe Persian summary. */
  summaryFa: string;
  /** Server-only detail (scrubbed before logging). */
  detail?: string;
  httpStatus?: number;
  retryable: boolean;
}

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly summaryFa: string;
  readonly detail?: string;
  readonly httpStatus?: number;
  readonly retryable: boolean;

  constructor(info: ProviderErrorInfo & { message?: string }) {
    super(info.message ?? info.summaryFa);
    this.name = "ProviderError";
    this.code = info.code;
    this.summaryFa = info.summaryFa;
    this.detail = info.detail;
    this.httpStatus = info.httpStatus;
    this.retryable = info.retryable;
  }

  toInfo(): ProviderErrorInfo {
    return {
      code: this.code,
      summaryFa: this.summaryFa,
      detail: this.detail,
      httpStatus: this.httpStatus,
      retryable: this.retryable,
    };
  }
}

export function timeoutError(ms: number): ProviderError {
  return new ProviderError({
    code: "timeout",
    summaryFa: "منبع در زمان مجاز پاسخ نداد",
    detail: `timeout after ${ms}ms`,
    retryable: true,
  });
}

export function networkError(detail: string): ProviderError {
  return new ProviderError({ code: "network", summaryFa: "ارتباط با منبع برقرار نشد", detail, retryable: true });
}

/**
 * Map an HTTP status to our taxonomy.
 * 401/403/451 and CAPTCHA-looking bodies are `prohibited` (never retried);
 * 429 is `rate-limited` (retried once, then reported);
 * other 4xx are `http-4xx` (not retried — our request is wrong);
 * 5xx is `http-5xx` (retried once).
 */
export function httpError(status: number, bodySnippet?: string): ProviderError {
  const snippet = bodySnippet?.slice(0, 300);
  if (status === 401 || status === 403 || status === 451) {
    return new ProviderError({
      code: "prohibited",
      summaryFa: "منبع دسترسی را محدود کرده است",
      detail: `HTTP ${status}${snippet ? `: ${snippet}` : ""}`,
      httpStatus: status,
      retryable: false,
    });
  }
  if (status === 429) {
    return new ProviderError({
      code: "rate-limited",
      summaryFa: "منبع درخواست‌ها را محدود کرده است",
      detail: `HTTP 429${snippet ? `: ${snippet}` : ""}`,
      httpStatus: status,
      retryable: true,
    });
  }
  if (status >= 500) {
    return new ProviderError({
      code: "http-5xx",
      summaryFa: "منبع دچار خطای داخلی شد",
      detail: `HTTP ${status}${snippet ? `: ${snippet}` : ""}`,
      httpStatus: status,
      retryable: true,
    });
  }
  return new ProviderError({
    code: "http-4xx",
    summaryFa: "درخواست مورد قبول منبع قرار نگرفت",
    detail: `HTTP ${status}${snippet ? `: ${snippet}` : ""}`,
    httpStatus: status,
    retryable: false,
  });
}

/** A CAPTCHA / challenge page rendered with HTTP 200. Never retried. */
export function challengeError(marker: string): ProviderError {
  return new ProviderError({
    code: "prohibited",
    summaryFa: "منبع صفحهٔ احراز هویت/کپچا برگرداند",
    detail: `challenge page detected (${marker})`,
    retryable: false,
  });
}

export function parseError(detail: string): ProviderError {
  return new ProviderError({ code: "parse", summaryFa: "پاسخ منبع قابل تفسیر نبود", detail, retryable: false });
}

export function schemaError(detail: string): ProviderError {
  return new ProviderError({ code: "schema", summaryFa: "پاسخ منبع با قالب انتظاری نمی‌خواند", detail, retryable: false });
}

export function notConfiguredError(detail: string): ProviderError {
  return new ProviderError({ code: "not-configured", summaryFa: "این منبع پیکربندی نشده است", detail, retryable: false });
}

export function coverageError(detail: string): ProviderError {
  return new ProviderError({ code: "coverage", summaryFa: "این منبع مسیر درخواستی را پوشش نمی‌دهد", detail, retryable: false });
}

/** Anything thrown by a library becomes a provider error, never a raw throw. */
export function asProviderError(error: unknown, fallback: ProviderErrorCode = "network"): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Error) {
    if (error.name === "AbortError") return timeoutError(0);
    return new ProviderError({
      code: fallback,
      summaryFa: "خطای پیش‌بینی‌نشده در ارتباط با منبع",
      detail: error.message,
      retryable: false,
    });
  }
  return new ProviderError({ code: fallback, summaryFa: "خطای ناشناخته", detail: String(error), retryable: false });
}
