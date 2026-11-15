import type { CrawlSource, CrawlSourceId } from "../types";
import { safarmarketSource } from "./safarmarket";
import { basisflySource } from "./basisfly";
import { flightioSource } from "./flightio";
import { mrbilitSource } from "./mrbilit";
import { alibabaSource } from "./alibaba";
import { flytodaySource } from "./flytoday";
export const CRAWLER_SOURCES: CrawlSource[] = [safarmarketSource, basisflySource, flightioSource, mrbilitSource, alibabaSource, flytodaySource];
/** Backwards-compatible short alias; CRAWLER_SOURCES is the canonical registry name. */
export const CRAWL_SOURCES = CRAWLER_SOURCES;
export function getCrawlSource(id: string): CrawlSource | undefined { return CRAWL_SOURCES.find((source) => source.id === id); }
export function isCrawlSourceId(value: string): value is CrawlSourceId { return CRAWL_SOURCES.some((source) => source.id === value); }

export const CRAWLER_PARSER_STATUS: Record<CrawlSourceId, string> = {
  safarmarket: "fixture-backed-parser; captured-POST; toman-and-Asia/Tehran-operator-assumptions",
  basisfly: "worker-opt-in; observed-session-free-template-required; MHD-THR-location-IDs-verified; timezone-naive-times-unresolved; currency-preserved; snapshots-only-no-price-history-adapter",
  flightio: "NOT_IMPLEMENTED: نیاز به fixture واقعی",
  mrbilit: "NOT_IMPLEMENTED: نیاز به fixture واقعی",
  alibaba: "NOT_IMPLEMENTED: نیاز به fixture واقعی",
  flytoday: "NOT_IMPLEMENTED: نیاز به fixture واقعی",
};
