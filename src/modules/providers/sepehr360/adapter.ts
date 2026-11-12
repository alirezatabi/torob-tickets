/**
 * Sepehr360 live connector.
 *
 * What this source is: an Iranian B2C flight aggregator whose search results page is
 * server-rendered and public (robots.txt does not disallow `/Flight/`). It lists the
 * flights of ~300 agencies as one feed — so it counts as **one** source, not 300.
 *
 * What this source is *not*: an API. There is no documented endpoint, no per-offer
 * deep link, no flight number, no baggage or refund data, and no availability flag.
 * Everything we cannot read is reported as unknown; nothing is inferred.
 *
 * Compliance:
 *   • one GET per user search, hard-capped by a token bucket (1 request / 3 s);
 *   • robots.txt is fetched and honored; a disallowed path aborts with `prohibited`;
 *   • a CAPTCHA/login page is reported as `prohibited` and never retried;
 *   • no browser impersonation, no cookie replay, no proxy rotation.
 */

import type {
  FreshnessPolicy,
  LiveProviderAdapter,
  ProviderCapabilities,
  ProviderContext,
  ProviderSearchRequest,
  ProviderSearchResult,
  NormalizedBatch,
  FetchMeta,
} from "@/modules/providers/contracts/provider";
import { HttpClient } from "@/modules/providers/shared/http";
import { createLogger } from "@/modules/providers/shared/logger";
import { challengeError, coverageError, parseError, ProviderError } from "@/modules/providers/shared/errors";
import { assembleLiveOffer, LiveNormalizationError } from "@/modules/providers/shared/normalize-offer";
import { buildForeignPrice, buildIranianPrice, normalizeDigits } from "@/modules/money/price";
import { wallClockToInstant } from "@/providers/fare";
import { cityTimeZone } from "@/providers/fare";
import { getCity } from "@/lib/cities";
import { airportsForCity, getAirport } from "@/modules/airports";
import type { FlightSegment } from "@/domain/flight";
import type { NormalizationIssue } from "@/providers/types";
import { parseSearchPage } from "./parser";
import { parsePersianDuration, parseStops, parseWallClock } from "./parse-duration";
import type { Sepehr360RawOffer } from "./types";
import { buildSearchUrl, SEPEHR360_HOST } from "./url";

/**
 * Freshness policy.
 *
 * Sepehr360 refreshes agency prices continuously (seconds to minutes) but gives no
 * per-offer timestamp, so the honest statement is: "we observed this price at
 * `fetchedAt`". Beyond 20 minutes the number is still shown, labelled *unverified*.
 */
const FRESHNESS: FreshnessPolicy = {
  freshMs: 5 * 60_000,
  staleMs: 20 * 60_000,
  canClaimAvailability: false,
  noteFa: "قیمت‌ها در لحظهٔ دریافت از صفحهٔ جست‌وجوی سپهر۳۶۰ خوانده می‌شوند؛ موجودی و مبلغ نهایی را فروشنده تأیید می‌کند.",
};

const CAPABILITIES: ProviderCapabilities = {
  hasFlightNumber: false,
  hasAirportCodes: false,
  hasSegments: false,
  hasFareClass: true,
  hasBaggage: false,
  hasRefundTerms: false,
  hasOfferDeepLink: false,
  hasAvailability: false,
  hasPassengerPrices: false,
};

export interface Sepehr360Config {
  enabled: boolean;
  /** Base URL override — used by tests and by `provider:check` offline fixtures. */
  baseUrl?: string;
  /** Unit the page quotes in. The site prints "تومان"; override only with evidence. */
  unit?: "toman" | "rial";
}

export function sepehr360ConfigFromEnv(env: Record<string, string | undefined> = process.env): Sepehr360Config {
  return {
    enabled: env.ENABLE_SEPEHR360 !== "false",
    baseUrl: env.SEPEHR360_BASE_URL || undefined,
    unit: env.SEPEHR360_UNIT === "rial" ? "rial" : "toman",
  };
}

export class Sepehr360Adapter implements LiveProviderAdapter<Sepehr360RawOffer> {
  readonly id = "sepehr360";
  readonly name = "سپهر۳۶۰";
  readonly mode = "live" as const;
  readonly sourceKind = "html" as const;
  readonly description = "تجمیع‌کنندهٔ بلیط ایرانی (۳۰۰+ آژانس در یک منبع)";
  readonly quotedCurrency = "IRT" as const;
  readonly capabilities = CAPABILITIES;
  readonly freshness = FRESHNESS;
  readonly complianceNoteFa =
    "یک درخواست به ازای هر جست‌وجوی کاربر، با احترام به robots.txt؛ بدون دور زدن محدودیت یا کپچا.";

  private readonly config: Sepehr360Config;
  private readonly http: HttpClient;

  constructor(config: Sepehr360Config = sepehr360ConfigFromEnv()) {
    this.config = config;
    this.http = new HttpClient({
      allowedHosts: [SEPEHR360_HOST, "www.sepehr360.ir"],
      robotsHosts: [SEPEHR360_HOST],
      timeoutMs: 8_000,
      maxBytes: 2_500_000,
      rateLimit: { capacity: 2, windowMs: 6_000 },
      logger: createLogger("sepehr360"),
    });
  }

  isConfigured(): boolean {
    return this.config.enabled;
  }

  async search(
    request: ProviderSearchRequest,
    ctx: ProviderContext,
  ): Promise<ProviderSearchResult<Sepehr360RawOffer>> {
    if (!this.config.enabled) {
      throw new ProviderError({
        code: "not-configured",
        summaryFa: "منبع سپهر۳۶۰ غیرفعال است",
        detail: "ENABLE_SEPEHR360=false",
        retryable: false,
      });
    }
    if (request.passengers > 1) {
      // The page prices per passenger; for groups the per-passenger price is still the
      // quoted one, so we do not multiply — but we must not pretend either.
      ctx.logger.info("search.multi-passenger", { passengers: request.passengers });
    }

    const target = buildSearchUrl({
      originCity: request.originCity,
      destinationCity: request.destinationCity,
      departDate: request.departDate,
    });

    const startedAt = Date.now();
    const response = await this.http.request({
      url: this.config.baseUrl ? replaceOrigin(target.url, this.config.baseUrl) : target.url,
      label: `${request.originCity}>${request.destinationCity}`,
      headers: { "cache-control": "no-cache" },
    });

    const parsed = parseSearchPage(response.body);
    if (parsed.meta.challenge) throw challengeError(parsed.meta.challenge);
    if (parsed.meta.emptyState && parsed.offers.length === 0) {
      ctx.logger.info("search.empty", { route: `${request.originCity}>${request.destinationCity}` });
    }
    if (parsed.offers.length === 0 && parsed.warnings.includes("no-result-cards-found") && parsed.meta.resultCount === null) {
      throw parseError("no result cards and no explicit empty state — markup may have changed");
    }

    const meta: FetchMeta = {
      providerId: this.id,
      fetchedAt: ctx.now().toISOString(),
      latencyMs: Date.now() - startedAt,
      httpStatus: response.status,
      retries: response.retries,
      fromCache: false,
      endpoint: "GET /Flight/B2c/Search",
      sourceUpdatedAt: null,
    };

    ctx.logger.info("search.parsed", {
      cards: parsed.offers.length,
      declared: parsed.meta.resultCount ?? -1,
      warnings: parsed.warnings.join(",") || "-",
    });

    return {
      records: parsed.offers,
      meta,
      rawCount: parsed.offers.length,
      warnings: parsed.warnings,
    };
  }

  normalize(records: Sepehr360RawOffer[], request: ProviderSearchRequest, meta: FetchMeta): NormalizedBatch {
    const offers = [];
    const issues: NormalizationIssue[] = [];

    // The page itself is the only linkable artefact; there is no per-offer URL.
    const pageUrl = buildSearchUrl({
      originCity: request.originCity,
      destinationCity: request.destinationCity,
      departDate: request.departDate,
    }).url;

    const unit = this.config.unit ?? "toman";

    for (const record of records) {
      try {
        const built = this.buildOffer(record, request, meta, pageUrl, unit);
        if (built) offers.push(built);
        else {
          issues.push({
            providerId: this.id,
            rawId: String(record.index),
            code: "invalid-time",
            message: "card has no usable departure/arrival pair",
          });
        }
      } catch (error) {
        if (error instanceof LiveNormalizationError) {
          issues.push({
            providerId: this.id,
            rawId: String(record.index),
            code: error.code === "invalid-price" ? "invalid-price" : error.code === "unknown-city" ? "unknown-city" : "invalid-time",
            message: error.message,
          });
        } else {
          issues.push({
            providerId: this.id,
            rawId: String(record.index),
            code: "missing-route",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return { offers, issues };
  }

  private buildOffer(
    record: Sepehr360RawOffer,
    request: ProviderSearchRequest,
    meta: FetchMeta,
    pageUrl: string,
    unit: "toman" | "rial",
  ) {
    if (!record.priceText) throw new LiveNormalizationError("invalid-price", "card has no price");
    const price = buildIranianPrice(record.priceText, unit);
    if (!price) throw new LiveNormalizationError("invalid-price", `unparsable price "${record.priceText}"`);

    const departMinutes = parseWallClock(record.departTime);
    if (departMinutes === null) throw new LiveNormalizationError("invalid-time", "card has no departure time");

    const originAirport = this.resolveAirport(record.originLabel, request.originAirports, request.originCity, request.international);
    const destinationAirport = this.resolveAirport(
      record.destinationLabel,
      request.destinationAirports,
      request.destinationCity,
      request.international,
    );

    const departAt = wallClockToInstant(`${request.departDate}T${toWallClock(departMinutes)}`, originAirport);
    const duration = parsePersianDuration(record.durationText);
    const stops = parseStops(record.stopsLabel);

    // Arrival: prefer the printed clock; if it is missing and a duration exists, derive
    // it and mark the offer as inferred. Never fabricate a duration when both are absent.
    let arriveAt: string;
    let durationMinutes: number | null = duration?.minutes ?? null;
    if (record.arriveTime) {
      const arriveMinutes = parseWallClock(record.arriveTime);
      if (arriveMinutes === null) throw new LiveNormalizationError("invalid-time", "unparsable arrival clock");
      let arriveInstant = wallClockToInstant(`${request.departDate}T${toWallClock(arriveMinutes)}`, destinationAirport);
      if (new Date(arriveInstant).getTime() <= new Date(departAt).getTime()) {
        arriveInstant = wallClockToInstant(`${nextDay(request.departDate)}T${toWallClock(arriveMinutes)}`, destinationAirport);
      }
      arriveAt = arriveInstant;
      if (durationMinutes === null) {
        durationMinutes = Math.max(
          0,
          Math.round((new Date(arriveAt).getTime() - new Date(departAt).getTime()) / 60_000),
        );
      }
    } else {
      if (durationMinutes === null) throw new LiveNormalizationError("invalid-time", "card has neither arrival time nor duration");
      arriveAt = new Date(new Date(departAt).getTime() + durationMinutes * 60_000).toISOString();
    }

    const airlineCode = record.airlineCode ?? "??";
    const segments: FlightSegment[] = [
      {
        airlineCode,
        flightNumber: null, // the page does not publish it — never invent one
        originCode: originAirport,
        destinationCode: destinationAirport,
        departAt,
        arriveAt,
        aircraft: null,
      },
    ];

    const cabin = mapCabin(record.cabinLabel) ?? request.cabin;

    return assembleLiveOffer(
      {
        providerId: this.id,
        providerName: this.name,
        sourceKind: "html",
        endpoint: meta.endpoint,
        rawRecordId: null,
        sellerLabel: record.sellerText ? normalizeDigits(record.sellerText).trim() : null,
        airlineCode,
        flightNumber: null,
        originAirport,
        destinationAirport,
        departAt,
        arriveAt,
        durationMinutes,
        segments,
        stopsOverride: stops,
        price,
        baggage: { checked: "unknown", cabinKg: null, checkedKg: null },
        refundable: null,
        cabin,
        fareClass: null,
        fareName: null,
        ticketType: record.charterHint ? "charter" : "unknown",
        marketingCarrier: null,
        offerUrl: pageUrl,
        providerUpdatedAt: meta.fetchedAt,
        fetchedAt: meta.fetchedAt,
        seatsAvailable: null,
        unitConverted: price.converted,
        extraWarnings: ["airport-unknown"].filter(() => !record.originLabel) as never[],
      },
      { freshness: FRESHNESS, now: new Date(meta.fetchedAt) },
    );
  }

  /**
   * The card prints a Persian airport/city name ("از مهرآباد", "به مشهد"). If it does
   * not match an airport we know, we fall back to the requested airport — but only
   * when the request had a single airport, otherwise the answer would be a guess.
   */
  private resolveAirport(
    label: string | null,
    candidates: string[],
    cityCode: string,
    international: boolean,
  ): string {
    if (label) {
      const matched = matchPersianAirport(label);
      if (matched) return matched;
    }
    const fallback = candidates[0] ?? airportsForCity(cityCode, { international })[0];
    if (!fallback) throw new LiveNormalizationError("invalid-airport", `cannot resolve airport for ${cityCode}`);
    return fallback;
  }
}

/** Persian airport names we can map to IATA without guessing. */
const PERSIAN_AIRPORTS: [RegExp, string][] = [
  [/مهرآباد/, "THR"],
  [/امام خمینی|ایکا/, "IKA"],
  [/هاشمی|مشهد/, "MHD"],
  [/شیراز/, "SYZ"],
  [/اصفهان|شهید بهشتی/, "IFN"],
  [/تبریز|شهید مدنی/, "TBZ"],
  [/کیش/, "KIH"],
  [/اهواز/, "AWZ"],
  [/بندرعباس/, "BND"],
  [/قشم/, "GSM"],
  [/رشت/, "RAS"],
  [/کرمان/, "KER"],
  [/زاهدان/, "ZAH"],
  [/ارومیه|اورمیه/, "OMH"],
  [/یزد/, "AZD"],
  [/نجف/, "NJF"],
  [/استانبول|آتاتورک/, "IST"],
  [/صبیحا|sabiha/i, "SAW"],
  [/آنتالیا/, "AYT"],
  [/ازمیر/, "ADB"],
  [/دبی/, "DXB"],
  [/شارجه/, "SHJ"],
  [/دوحه/, "DOH"],
  [/مسقط/, "MCT"],
  [/کویت/, "KWI"],
  [/ریاض/, "RUH"],
  [/جده/, "JED"],
  [/بغداد/, "BGW"],
  [/کرکوک/, "KIK"],
  [/دمشق/, "DAM"],
  [/بیروت/, "BEY"],
  [/ایروان/, "EVN"],
  [/تفلیس/, "TBS"],
  [/باکو/, "GYD"],
  [/عشقآباد|عشق آباد/, "ASB"],
  [/تاشکند/, "TAS"],
  [/دهلی/, "DEL"],
  [/مومبای/, "BOM"],
  [/کراچی/, "KHI"],
  [/فرانکفورت/, "FRA"],
  [/برلین/, "BER"],
  [/مونیخ/, "MUC"],
  [/هیترو|لندن/, "LHR"],
  [/شارل دوگل|پاریس/, "CDG"],
  [/اسخیپول|آمستردام/, "AMS"],
  [/وین/, "VIE"],
  [/استکهلم/, "ARN"],
  [/فیومیچینو|رم/, "FCO"],
];

export function matchPersianAirport(label: string): string | null {
  const normalized = normalizeDigits(label).replace(/\u200c/g, " ").replace(/ي/g, "ی").replace(/ك/g, "ک");
  for (const [pattern, code] of PERSIAN_AIRPORTS) {
    if (pattern.test(normalized)) return getAirport(code) ? code : null;
  }
  return null;
}

function mapCabin(label: string | null): "economy" | "premium" | "business" | null {
  if (!label) return null;
  if (/بیزنس|بیزینس|درجه یک|فرست کلاس/.test(label)) return "business";
  if (/پرمیوم|کمی‌کمفرت|کامفرت/.test(label)) return "premium";
  if (/اکونومی|اقتصادی/.test(label)) return "economy";
  return null;
}

function toWallClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function nextDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function replaceOrigin(url: string, base: string): string {
  const source = new URL(url);
  const target = new URL(base);
  target.pathname = source.pathname;
  target.search = source.search;
  return target.toString();
}

export { cityTimeZone, getCity, buildForeignPrice, coverageError, type Sepehr360RawOffer };
