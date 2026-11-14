import type { CrawlSource, CrawlSourceId } from "../types";
import { safarmarketSource } from "./safarmarket";
import { flightioSource } from "./flightio";
import { mrbilitSource } from "./mrbilit";
import { alibabaSource } from "./alibaba";
import { flytodaySource } from "./flytoday";
export const CRAWLER_SOURCES: CrawlSource[] = [safarmarketSource, flightioSource, mrbilitSource, alibabaSource, flytodaySource];
/** Backwards-compatible short alias; CRAWLER_SOURCES is the canonical registry name. */
export const CRAWL_SOURCES = CRAWLER_SOURCES;
export function getCrawlSource(id: string): CrawlSource | undefined { return CRAWL_SOURCES.find((source) => source.id === id); }
export function isCrawlSourceId(value: string): value is CrawlSourceId { return CRAWL_SOURCES.some((source) => source.id === value); }

export const CRAWLER_PARSER_STATUS: Record<CrawlSourceId, string> = {
  safarmarket: "fixture-backed-parser; blocked-session-and-reCAPTCHA-request; currency-and-time-zone-unresolved",
  flightio: "NOT_IMPLEMENTED: نیاز به fixture واقعی",
  mrbilit: "NOT_IMPLEMENTED: نیاز به fixture واقعی",
  alibaba: "NOT_IMPLEMENTED: نیاز به fixture واقعی",
  flytoday: "NOT_IMPLEMENTED: نیاز به fixture واقعی",
};
