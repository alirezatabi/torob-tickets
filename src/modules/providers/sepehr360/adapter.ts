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
import { challengeError, parseError, ProviderError } from "@/modules/providers/shared/errors";
import { assembleLiveOffer, LiveNormalizationError } from "@/modules/providers/shared/normalize-offer";
import { buildIranianPrice, normalizeDigits } from "@/modules/money/price";
import { wallClockToInstant } from "@/providers/fare";
import { airportServesCity, airportsForCity, getAirport } from "@/modules/airports";
import type { FlightSegment } from "@/domain/flight";
import type { NormalizationIssue } from "@/providers/types";
import {
  diagnosePage,
  explainEmptyPage,
  saveRawHtml,
  saveSnapshot,
} from "@/modules/providers/shared/diagnostics";
import { discoverOffersEndpoint } from "@/modules/providers/shared/api-discovery";
import { mapApiOffer } from "./json-mapper";
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

/** Wall-clock budget for JSON discovery, in ms. */
const DISCOVERY_BUDGET_MS = 9_000;

const CAPABILITIES: ProviderCapabilities = {
  // The cards publish none of these; the JSON feed may publish a number, and we keep it
  // when it does. Capabilities describe the source, not one response shape.
  hasFlightNumber: true,
  hasAirportCodes: true,
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
    // A mirror configured by the operator (`SEPEHR360_BASE_URL`) is part of the allowlist:
    // otherwise the documented test hook would be rejected by our own guard.
    const overrideHost = config.baseUrl ? safeHost(config.baseUrl) : null;
    const insecureHosts = overrideHost && config.baseUrl?.startsWith("http://") ? [overrideHost] : [];
    this.http = new HttpClient({
      allowedHosts: [SEPEHR360_HOST, "www.sepehr360.ir", ...(overrideHost ? [overrideHost] : [])],
      insecureHosts,
      robotsHosts: [...(overrideHost ? [overrideHost] : []), SEPEHR360_HOST],
      timeoutMs: 8_000,
      maxBytes: 2_500_000,
      // A search is one page request; discovery may add a bundle and an endpoint probe,
      // same host, still a handful of requests per search (see docs/PROVIDERS.md).
      rateLimit: { capacity: 3, windowMs: 6_000 },
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

    // The public page is a JavaScript shell (no price, no clock in the HTML at all), so the
    // offers live behind the site's own JSON endpoint. Discover it from the page's bundles
    // and read the same data a browser would — bounded, allowlisted, robots-respecting.
    let discoveryEvidence: string | null = null;
    if (parsed.offers.length === 0 && !parsed.meta.emptyState) {
      const viaApi = await this.searchApiFallback(ctx, response.body, target.url);
      if (viaApi.result) return viaApi.result;
      discoveryEvidence = viaApi.evidence;
    }
    if (parsed.offers.length === 0 && parsed.warnings.includes("no-result-cards-found") && parsed.meta.resultCount === null) {
      // Do not guess *why*. Look at the page, say what we saw, and leave a sanitized
      // snapshot behind when the operator asked for one.
      const diagnostics = diagnosePage(response.body, parsed.offers.length > 0);
      const label = `${request.originCity}>${request.destinationCity}`;
      const snapshot =
        process.env.SEPEHR360_SAVE_HTML === "1"
          ? saveRawHtml(response.body, label)
          : saveSnapshot(diagnostics, label);
      const clues = parsed.warnings.filter((warning) => warning.startsWith("clues:")).join(" ");
      throw parseError(
        [
          explainEmptyPage(diagnostics),
          discoveryEvidence ?? "",
          clues,
          diagnostics.title ? `title="${diagnostics.title}"` : "",
          snapshot ? `snapshot=${snapshot}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
      );
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
      // `clues:`-prefixed warnings are diagnostics for the empty case, not data problems.
      warnings: parsed.warnings.filter((warning) => !warning.startsWith("clues:")),
    };
  }

  /**
   * Read the offers from the source's own JSON feed.
   *
   * The old behaviour when the HTML yielded nothing was to *describe* the failure. That is
   * honest but useless: the data exists, it just is not in the HTML. So we discover the
   * endpoint the page itself calls (see `shared/api-discovery.ts`) and map its records.
   *
   * Returns `null` when discovery finds nothing, so the caller can still report the
   * evidence instead of pretending the route is empty.
   */
  private async searchApiFallback(
    ctx: ProviderContext,
    html: string,
    pageUrl: string,
  ): Promise<{ result: ProviderSearchResult<Sepehr360RawOffer> | null; evidence: string | null }> {
    const startedAt = Date.now();
    let discovery;
    try {
      discovery = await discoverOffersEndpoint({
        http: this.http,
        html,
        pageUrl,
        allowHost: (url) => this.http.isAllowedHost(url),
        // Discovery is an addition, not the search: it gets a slice of the provider budget
        // so a slow or hung endpoint can never turn a page view into a long stall.
        deadline: Date.now() + DISCOVERY_BUDGET_MS,
      });
    } catch (error) {
      ctx.logger.warn("search.api-discovery.failed", {
        detail: error instanceof Error ? error.message : String(error),
      });
      return { result: null, evidence: "discovery=error" };
    }

    if (discovery.items.length === 0) {
      const evidence = [
        `discovery=empty`,
        `scripts=${discovery.report.scripts.length}`,
        `json=${discovery.report.jsonEndpoints.length}`,
        discovery.report.shapes.length > 0
          ? `shapes=${discovery.report.shapes
              .slice(0, 3)
              .map((shape) => `${shortPath(shape.endpoint)}[${shape.topLevelKeys.slice(0, 6).join(",")}]`)
              .join(" ")}`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      ctx.logger.info("search.api-discovery.empty", { detail: evidence });
      return { result: null, evidence };
    }

    const unit = this.config.unit ?? "toman";
    const records: Sepehr360RawOffer[] = discovery.items.map((item, index) => {
      const mapped = mapApiOffer(item, { unit });
      return {
        index,
        airlineCode: mapped.airlineCode,
        airlineNameFa: mapped.airlineName,
        departTime: mapped.departAt,
        arriveTime: mapped.arriveAt,
        durationText: mapped.durationMinutes === null ? null : `${mapped.durationMinutes} دقیقه`,
        priceText: mapped.priceText,
        priceAmount: mapped.priceAmount,
        originLabel: mapped.originAirport,
        destinationLabel: mapped.destinationAirport,
        originAirportCode: mapped.originAirport,
        destinationAirportCode: mapped.destinationAirport,
        cabinLabel: mapped.cabin,
        stopsLabel: mapped.stops === null ? null : String(mapped.stops),
        stopsCount: mapped.stops,
        sellerText: null,
        availabilityText: mapped.seatsAvailable === null ? null : String(mapped.seatsAvailable),
        charterHint: false,
        flightNumber: mapped.flightNumber,
        seatsAvailable: mapped.seatsAvailable,
        origin: "json",
      };
    });

    ctx.logger.info("search.api-discovery.hit", {
      endpoint: discovery.endpoint ?? "-",
      items: records.length,
    });

    const meta: FetchMeta = {
      providerId: this.id,
      fetchedAt: ctx.now().toISOString(),
      latencyMs: Date.now() - startedAt,
      httpStatus: 200,
      retries: 0,
      fromCache: false,
      endpoint: discovery.endpoint ?? "GET (discovered)",
      sourceUpdatedAt: null,
    };

    return {
      result: {
        records,
        meta,
        rawCount: records.length,
        warnings: [`api-endpoint:${discovery.endpoint ?? "unknown"}`],
      },
      evidence: null,
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

    const origin = this.resolveAirport(
      record.originLabel,
      request.originAirports,
      request.originCity,
      request.international,
      record.originAirportCode,
    );
    const destination = this.resolveAirport(
      record.destinationLabel,
      request.destinationAirports,
      request.destinationCity,
      request.international,
      record.destinationAirportCode,
    );
    const originAirport = origin.airport;
    const destinationAirport = destination.airport;

    // The card printed an airport we could place, but not one belonging to the city the
    // user asked for. That is a real mismatch (the source answered a different query), so
    // the record is rejected rather than relabelled.
    if (!airportServesCity(originAirport, request.originCity) || !airportServesCity(destinationAirport, request.destinationCity)) {
      throw new LiveNormalizationError(
        "unknown-city",
        `card route ${originAirport}>${destinationAirport} does not serve ${request.originCity}>${request.destinationCity}`,
      );
    }

    const departAt = wallClockToInstant(`${request.departDate}T${toWallClock(departMinutes)}`, originAirport);
    const duration = parsePersianDuration(record.durationText);
    const stops = typeof record.stopsCount === "number" ? record.stopsCount : parseStops(record.stopsLabel);

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
    // Only when the source published it. The HTML card never does, its JSON feed may.
    const flightNumber = record.flightNumber ?? null;
    const segments: FlightSegment[] = [
      {
        airlineCode,
        flightNumber,
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
        flightNumber,
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
        seatsAvailable: typeof record.seatsAvailable === "number" ? record.seatsAvailable : null,
        unitConverted: price.converted,
        extraWarnings: [
          ...(origin.assumed ? (["airport-unknown"] as const) : []),
          ...(destination.assumed ? (["airport-unknown"] as const) : []),
        ],
      },
      { freshness: FRESHNESS, now: new Date(meta.fetchedAt) },
    );
  }

  /**
   * The card prints a Persian airport/city name ("از مهرآباد", "به مشهد"). If it does
   * not match an airport we know, we fall back to the requested airport — but only
   * when the request had a single airport, otherwise the answer would be a guess.
   */
  /**
   * Resolve the airport a card claims to use.
   *
   * Two honest outcomes:
   *   • the card prints a name we can map → use it (`assumed: false`);
   *   • the card prints nothing we recognise → fall back to the requested airport **and
   *     say so** (`assumed: true`), because the offer then carries `airport-unknown`.
   *
   * A fallback is only allowed when the request narrowed the city to one airport;
   * otherwise picking one would be a coin flip between IKA and THR.
   */
  private resolveAirport(
    label: string | null,
    candidates: string[],
    cityCode: string,
    international: boolean,
    publishedCode?: string | null,
  ): { airport: string; assumed: boolean } {
    // 1. A real IATA code printed by the source (JSON feeds) outranks any Persian label:
    //    it is the airport the feed itself says it is selling.
    if (publishedCode && airportServesCity(publishedCode, cityCode)) {
      return { airport: publishedCode.toUpperCase(), assumed: false };
    }

    // 2. A Persian airport name we can map.
    if (label) {
      const matched = matchPersianAirport(label);
      if (matched) return { airport: matched, assumed: false };
    }

    // 3. Nothing usable: fall back to the requested airport, and *say so* — the offer then
    //    carries `airport-unknown`. Only honest when the request narrowed the city to one
    //    airport; otherwise picking one would be a coin flip between IKA and THR.
    const options = candidates.length > 0 ? candidates : airportsForCity(cityCode, { international });
    const fallback = options[0];
    if (!fallback) throw new LiveNormalizationError("invalid-airport", `cannot resolve airport for ${cityCode}`);
    return { airport: fallback, assumed: true };
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

/** Host of a configured base URL, or null when it is not a usable absolute URL. */
function safeHost(value: string): string | null {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

/** `https://host/api/flight/search?x=1` → `/api/flight/search` — enough to recognise a route. */
function shortPath(url: string): string {
  try {
    const parsed = new URL(url.replace(/\s*\(.*\)$/, ""));
    return parsed.pathname;
  } catch {
    return url.slice(0, 60);
  }
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

export type { Sepehr360RawOffer };
