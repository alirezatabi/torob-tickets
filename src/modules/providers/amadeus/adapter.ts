/**
 * Amadeus Self-Service connector (official API).
 *
 * Positioning, per correction #1: this is an independent, *official* source, but it is
 * **not** a replacement for Iranian market prices. Its coverage of Iranian domestic
 * routes is thin, prices are in foreign currency, and the test environment returns
 * cached sample data. So:
 *   • `AMADEUS_ENV` is explicit, and test data is labelled in every offer and in the UI;
 *   • foreign-currency prices are never converted to toman with an invented FX rate —
 *     they are stored with their own currency and shown as "قیمت ارزی" with the amount;
 *   • availability is claimed only when `numberOfBookableSeats > 0` is present;
 *   • `POST /v1/shopping/flight-offers/pricing` re-verifies price + availability, and
 *     the result is stored as `lastVerifiedAt` (or reported as unverifiable).
 */

import type {
  FetchMeta,
  FreshnessPolicy,
  LiveProviderAdapter,
  NormalizedBatch,
  ProviderCapabilities,
  ProviderContext,
  ProviderSearchRequest,
  ProviderSearchResult,
} from "@/modules/providers/contracts/provider";
import { HttpClient } from "@/modules/providers/shared/http";
import { createLogger } from "@/modules/providers/shared/logger";
import { networkError, notConfiguredError, ProviderError } from "@/modules/providers/shared/errors";
import { assembleLiveOffer, LiveNormalizationError } from "@/modules/providers/shared/normalize-offer";
import { buildForeignPrice } from "@/modules/money/price";
import { wallClockToInstant } from "@/providers/fare";
import { airportCity, getAirport } from "@/modules/airports";
import { resolveAirlineCode } from "@/modules/airlines/registry";
import type { FlightSegment } from "@/domain/flight";
import type { NormalizationIssue } from "@/providers/types";
import {
  amadeusBaseUrl,
  amadeusCredentialsFromEnv,
  AmadeusTokenProvider,
  type AmadeusCredentials,
} from "./auth";
import {
  extractCabin,
  extractCheckedBaggageKg,
  extractFareDetails,
  parseAmountString,
  parseFlightOffersResponse,
  parseIsoDuration,
  parsePricingResponse,
  type AmadeusEnv,
  type AmadeusRawOffer,
  type AmadeusRepricingResult,
} from "./parse";

const FRESHNESS: FreshnessPolicy = {
  freshMs: 10 * 60_000,
  staleMs: 30 * 60_000,
  canClaimAvailability: true,
  noteFa: "قیمت‌های Amadeus از API رسمی می‌آیند؛ در محیط تست، داده‌ها نمونهٔ کش‌شده‌اند و قیمت واقعی نیستند.",
};

const CAPABILITIES: ProviderCapabilities = {
  hasFlightNumber: true,
  hasAirportCodes: true,
  hasSegments: true,
  hasFareClass: true,
  hasBaggage: true,
  hasRefundTerms: false, // the search response does not state refundability
  hasOfferDeepLink: false, // Amadeus is a B2B API; there is no public offer page
  hasAvailability: true,
  hasPassengerPrices: true,
};

export interface AmadeusConfig {
  enabled: boolean;
  env: AmadeusEnv;
  credentials: AmadeusCredentials | null;
  /** Override for tests. */
  baseUrl?: string;
}

export function amadeusConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AmadeusConfig {
  const amadeusEnv: AmadeusEnv = env.AMADEUS_ENV === "production" ? "production" : "test";
  const enabled = env.ENABLE_AMADEUS === "true" || Boolean(amadeusCredentialsFromEnv(env));
  return {
    enabled,
    env: amadeusEnv,
    credentials: amadeusCredentialsFromEnv(env),
    baseUrl: env.AMADEUS_BASE_URL || undefined,
  };
}

const CABIN_MAP: Record<string, "economy" | "premium" | "business" | "first"> = {
  ECONOMY: "economy",
  PREMIUM_ECONOMY: "premium",
  BUSINESS: "business",
  FIRST: "first",
};

export class AmadeusAdapter implements LiveProviderAdapter<AmadeusRawOffer> {
  readonly id = "amadeus";
  readonly name = "Amadeus";
  readonly mode = "live" as const;
  readonly sourceKind = "api" as const;
  readonly description = "API رسمی Amadeus Self-Service (منبع مستقل، پوشش بازار ایران محدود)";
  readonly quotedCurrency = "EUR" as const;
  readonly capabilities = CAPABILITIES;
  readonly freshness = FRESHNESS;
  readonly complianceNoteFa =
    "استفاده از API رسمی با کلید خودِ کاربر و محدودیت نرخ اعلام‌شده؛ دادهٔ محیط تست هرگز به‌عنوان قیمت واقعی نمایش داده نمی‌شود.";

  private readonly config: AmadeusConfig;
  private readonly http: HttpClient;
  private readonly tokens: AmadeusTokenProvider | null;

  constructor(config: AmadeusConfig = amadeusConfigFromEnv()) {
    this.config = config;
    const logger = createLogger("amadeus");
    const host = new URL(amadeusBaseUrl(config.env)).host;
    this.http = new HttpClient({
      allowedHosts: [host],
      timeoutMs: 6_000,
      maxBytes: 1_500_000,
      rateLimit: { capacity: 5, windowMs: 5_000 },
      logger,
    });
    this.tokens = config.credentials
      ? new AmadeusTokenProvider({ credentials: config.credentials, env: config.env, logger })
      : null;
  }

  isConfigured(): boolean {
    return this.config.enabled && this.config.credentials !== null;
  }

  private endpoint(path: string): string {
    return `${this.config.baseUrl ?? amadeusBaseUrl(this.config.env)}${path}`;
  }

  async search(
    request: ProviderSearchRequest,
    ctx: ProviderContext,
  ): Promise<ProviderSearchResult<AmadeusRawOffer>> {
    if (!this.isConfigured() || !this.tokens) throw notConfiguredError("AMADEUS_CLIENT_ID/SECRET is not set");

    const originAirport = request.originAirports[0];
    const destinationAirport = request.destinationAirports[0];
    if (!originAirport || !destinationAirport) throw notConfiguredError("origin/destination airport unresolved");

    const query = new URLSearchParams({
      originLocationCode: originAirport,
      destinationLocationCode: destinationAirport,
      departureDate: request.departDate,
      adults: String(Math.max(1, request.passengers)),
      currencyCode: "EUR",
      max: "50",
      nonStop: "false",
    });
    if (request.cabin !== "economy") query.set("travelClass", request.cabin.toUpperCase());

    const token = await this.tokens.getToken();
    const startedAt = Date.now();
    const response = await this.http.request({
      url: this.endpoint(`/v2/shopping/flight-offers?${query.toString()}`),
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.amadeus+json" },
      label: `${request.originCity}>${request.destinationCity}`,
    });

    const payload = safeJson(response.body);
    const parsed = parseFlightOffersResponse(payload, this.config.env);

    if (parsed.offers.length === 0 && hasAmadeusErrors(payload)) {
      // Amadeus reports "no results" as a 200 with an errors array; surface it as a
      // coverage error rather than an empty-but-successful search.
      throw new ProviderError({
        code: "coverage",
        summaryFa: "Amadeus برای این مسیر پروازی برنگرداند",
        detail: parsed.warnings.join(",") || "no offers",
        retryable: false,
      });
    }

    const meta: FetchMeta = {
      providerId: this.id,
      fetchedAt: ctx.now().toISOString(),
      latencyMs: Date.now() - startedAt,
      httpStatus: response.status,
      retries: response.retries,
      fromCache: false,
      endpoint: `GET /v2/shopping/flight-offers (${this.config.env})`,
      sourceUpdatedAt: null,
    };

    ctx.logger.info("search.parsed", { offers: parsed.offers.length, env: this.config.env });

    return { records: parsed.offers, meta, rawCount: parsed.offers.length, warnings: parsed.warnings };
  }

  normalize(records: AmadeusRawOffer[], request: ProviderSearchRequest, meta: FetchMeta): NormalizedBatch {
    const offers = [];
    const issues: NormalizationIssue[] = [];

    for (const record of records) {
      try {
        const offer = this.buildOffer(record, request, meta);
        if (offer) offers.push(offer);
      } catch (error) {
        issues.push({
          providerId: this.id,
          rawId: record.id,
          code:
            error instanceof LiveNormalizationError && error.code === "invalid-price"
              ? "invalid-price"
              : error instanceof LiveNormalizationError && error.code === "unknown-city"
                ? "unknown-city"
                : "invalid-time",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { offers, issues };
  }

  private buildOffer(record: AmadeusRawOffer, request: ProviderSearchRequest, meta: FetchMeta) {
    const itinerary = record.itineraries[0];
    if (!itinerary || itinerary.segments.length === 0) {
      throw new LiveNormalizationError("missing-route", "no itineraries");
    }

    const total = record.price?.total ?? record.price?.grandTotal ?? null;
    const currency = record.price?.currency ?? null;
    const amountMinor = parseAmountString(record.price?.grandTotal ?? total);
    if (!currency || amountMinor === null) {
      throw new LiveNormalizationError("invalid-price", "missing or malformed price");
    }
    const price = buildForeignPrice(record.price?.grandTotal ?? (total as string), currency);
    if (!price) throw new LiveNormalizationError("invalid-price", `unparsable price ${total}`);

    const segments: FlightSegment[] = itinerary.segments.map((segment) => {
      const originAirport = segment.departure.iataCode;
      const destinationAirport = segment.arrival.iataCode;
      if (!getAirport(originAirport) && !getAirport(destinationAirport)) {
        throw new LiveNormalizationError("unknown-city", `unknown airports ${originAirport}>${destinationAirport}`);
      }
      const airline = resolveAirlineCode({ logoUrl: null, nameFa: null, nameEn: null });
      const code = segment.carrierCode;
      void airline;
      return {
        airlineCode: code,
        flightNumber: `${code}-${segment.number}`,
        originCode: originAirport,
        destinationCode: destinationAirport,
        departAt: wallClockToInstant(segment.departure.at, originAirport),
        arriveAt: wallClockToInstant(segment.arrival.at, destinationAirport),
        aircraft: segment.aircraft?.code ?? null,
      };
    });

    const first = segments[0];
    const last = segments[segments.length - 1];
    if (!first || !last) throw new LiveNormalizationError("missing-route", "empty segments");

    const originCity = airportCity(first.originCode) ?? first.originCode;
    const destinationCity = airportCity(last.destinationCode) ?? last.destinationCode;

    // Cabin: explicit, else fail over to the requested cabin *with a warning*.
    const cabinRaw = extractCabin(record);
    const cabin = cabinRaw ? (CABIN_MAP[cabinRaw] ?? (request.cabin as "economy")) : (request.cabin as "economy");
    const fareDetails = extractFareDetails(record) ?? [];
    const firstFare = fareDetails[0];
    const fareClass = firstFare?.class ?? null;
    const fareBasis = firstFare?.fareBasis ?? null;
    const bags = extractCheckedBaggageKg(record);
    const airlineCode = record.validatingAirlineCode ?? first.airlineCode;

    const durationMinutes =
      parseIsoDuration(itinerary.duration) ??
      Math.max(0, Math.round((new Date(last.arriveAt).getTime() - new Date(first.departAt).getTime()) / 60_000));

    const seats = record.numberOfBookableSeats;

    return assembleLiveOffer(
      {
        providerId: this.id,
        providerName: this.name,
        sourceKind: "api",
        endpoint: meta.endpoint,
        rawRecordId: record.id,
        sellerLabel: null,
        airlineCode,
        flightNumber: first.flightNumber,
        originAirport: first.originCode,
        destinationAirport: last.destinationCode,
        departAt: first.departAt,
        arriveAt: last.arriveAt,
        durationMinutes,
        segments,
        stopsOverride: Math.max(0, segments.length - 1),
        price,
        baggage: {
          checked: bags.included ? "included" : "not-included",
          cabinKg: null,
          checkedKg: bags.kg,
        },
        refundable: null,
        cabin: cabin === "first" ? "business" : cabin,
        fareClass: fareBasis ?? fareClass,
        fareName: record.source ?? null,
        ticketType: "system",
        marketingCarrier: null,
        offerUrl: `amadeus:${record.id}`,
        providerUpdatedAt: meta.fetchedAt,
        fetchedAt: meta.fetchedAt,
        seatsAvailable: seats,
        unitConverted: false,
        extraWarnings: buildAmadeusWarnings(record, cabinRaw, total, currency, {
          originCity,
          destinationCity,
          request,
        }),
      },
      { freshness: FRESHNESS, now: new Date(meta.fetchedAt) },
    );
  }

  /**
   * Re-verify price + availability for a specific offer.
   * Returns a result the caller can persist as `lastVerifiedAt` — or a clear reason why
   * verification was impossible, which the UI must show instead of a green check.
   */
  async verifyOffer(rawOffer: unknown): Promise<AmadeusRepricingResult> {
    if (!this.isConfigured() || !this.tokens) {
      return { ok: false, total: null, reason: "not-configured" };
    }
    const token = await this.tokens.getToken();
    const response = await this.http.request({
      url: this.endpoint("/v1/shopping/flight-offers/pricing"),
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/vnd.amadeus+json",
        accept: "application/vnd.amadeus+json",
      },
      body: JSON.stringify({ data: { type: "flight-offers-pricing", flightOffers: [rawOffer] } }),
      label: "pricing",
    });
    return parsePricingResponse(safeJson(response.body));
  }
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw networkError("Amadeus returned non-JSON body");
  }
}

function hasAmadeusErrors(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const errors = (payload as { errors?: unknown }).errors;
  return Array.isArray(errors) && errors.length > 0;
}

/**
 * Every caveat that applies to an Amadeus offer, made explicit so the UI can print it
 * instead of implying more than we know.
 */
function buildAmadeusWarnings(
  record: AmadeusRawOffer,
  cabinRaw: string | null,
  total: string | null,
  currency: string,
  context: { originCity: string; destinationCity: string; request: ProviderSearchRequest },
): import("@/domain/flight").OfferWarning[] {
  void context;
  const warnings: import("@/domain/flight").OfferWarning[] = [];
  if (record.env === "test") warnings.push("availability-unverified");
  if (!cabinRaw) warnings.push("baggage-unknown");
  if (parseAmountString(total) === null) warnings.push("price-converted");
  if (currency !== "IRR" && currency !== "IRT") warnings.push("price-converted");
  return warnings;
}

export { parsePricingResponse, type AmadeusRepricingResult };
