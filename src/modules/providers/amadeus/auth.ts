/**
 * Amadeus OAuth2 client-credentials token handling.
 *
 * The token is cached in memory until shortly before it expires, because Amadeus
 * rate-limits token requests and a token per search would be wasteful and rude.
 * Credentials never leave the server: they are read from env, never logged, and the
 * `HttpClient` treats any URL containing them as out of bounds (they are sent in a body,
 * over HTTPS, to a fixed host).
 */

import { notConfiguredError, ProviderError } from "@/modules/providers/shared/errors";
import type { Logger } from "@/modules/providers/shared/logger";
import type { AmadeusEnv } from "./parse";

export interface AmadeusCredentials {
  clientId: string;
  clientSecret: string;
}

export interface AmadeusTokenCache {
  token: string | null;
  expiresAt: number;
}

export function amadeusBaseUrl(env: AmadeusEnv): string {
  return env === "production" ? "https://api.amadeus.com" : "https://test.api.amadeus.com";
}

export function amadeusCredentialsFromEnv(env: Record<string, string | undefined> = process.env): AmadeusCredentials | null {
  // Test and production credentials are strictly separate — no fallback between them.
  const suffix = (env.AMADEUS_ENV ?? "test") === "production" ? "PRODUCTION" : "TEST";
  const clientId = env[`AMADEUS_CLIENT_ID_${suffix}`] ?? (suffix === "TEST" ? env.AMADEUS_CLIENT_ID : undefined);
  const clientSecret =
    env[`AMADEUS_CLIENT_SECRET_${suffix}`] ?? (suffix === "TEST" ? env.AMADEUS_CLIENT_SECRET : undefined);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export interface TokenFetchResult {
  accessToken: string;
  expiresInSeconds: number;
}

/**
 * Exchange client credentials for a token. Kept as a plain function with an injectable
 * fetch so it is unit-testable without network access.
 */
export async function fetchAmadeusToken(
  credentials: AmadeusCredentials,
  env: AmadeusEnv,
  fetchImpl: typeof fetch,
  timeoutMs = 6_000,
): Promise<TokenFetchResult> {
  if (!credentials.clientId || !credentials.clientSecret) {
    throw notConfiguredError("Amadeus credentials are empty");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${amadeusBaseUrl(env)}/v1/security/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }).toString(),
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await response.text();
    if (!response.ok) {
      throw new ProviderError({
        code: response.status >= 500 ? "http-5xx" : "prohibited",
        summaryFa:
          response.status === 401
            ? "کلیدهای Amadeus پذیرفته نشد (محیط تست/عملیاتی را بررسی کنید)"
            : "دریافت توکن Amadeus ناموفق بود",
        detail: `HTTP ${response.status}`,
        httpStatus: response.status,
        retryable: response.status >= 500,
      });
    }

    const payload = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) {
      throw new ProviderError({
        code: "schema",
        summaryFa: "پاسخ توکن Amadeus قالب انتظاری را نداشت",
        detail: "missing access_token",
        retryable: false,
      });
    }
    return {
      accessToken: payload.access_token,
      expiresInSeconds: typeof payload.expires_in === "number" ? payload.expires_in : 1_799,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** In-memory token provider with a safety margin before expiry. */
export class AmadeusTokenProvider {
  private cache: AmadeusTokenCache = { token: null, expiresAt: 0 };

  constructor(
    private readonly deps: {
      credentials: AmadeusCredentials;
      env: AmadeusEnv;
      fetchImpl?: typeof fetch;
      logger: Logger;
      now?: () => number;
    },
  ) {}

  async getToken(): Promise<string> {
    const now = this.deps.now ? this.deps.now() : Date.now();
    if (this.cache.token && this.cache.expiresAt - 60_000 > now) return this.cache.token;

    const { accessToken, expiresInSeconds } = await fetchAmadeusToken(
      this.deps.credentials,
      this.deps.env,
      this.deps.fetchImpl ?? globalThis.fetch,
    );
    this.cache = { token: accessToken, expiresAt: now + expiresInSeconds * 1_000 };
    this.deps.logger.info("amadeus.token.refreshed", { env: this.deps.env, ttl: expiresInSeconds });
    return accessToken;
  }

  /** Test hook. */
  invalidate(): void {
    this.cache = { token: null, expiresAt: 0 };
  }
}
