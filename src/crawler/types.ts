export const CRAWL_SOURCE_IDS = ["safarmarket", "flightio", "mrbilit", "alibaba", "flytoday"] as const;
export type CrawlSourceId = (typeof CRAWL_SOURCE_IDS)[number];

/** Untrusted source facts. Unknown fields stay null; normalization never guesses. */
export interface RawOffer {
  id: string | null;
  origin: string | null;
  destination: string | null;
  departAt: string | null;
  arriveAt: string | null;
  airline: string | null;
  flightNumber: string | null;
  amount: number | null;
  currency: string | null;
  seats: number | null;
  offerUrl: string | null;
  [key: string]: unknown;
}

export interface CrawlQuery {
  originCode: string;
  destinationCode: string;
  departDate: string;
  passengers: number;
  cabin: string;
}

export interface CrawlRequestSpec {
  url: string;
  method: "GET" | "POST";
  /** Exact source-observed payload. Null means the request is deliberately blocked. */
  body: string | null;
  blockedReason?: string;
}

export interface CrawlSource {
  readonly id: CrawlSourceId;
  readonly name: string;
  readonly origin: string;
  /** Request construction must use only endpoint/parameters present in a capture. */
  buildRequests(query: CrawlQuery): CrawlRequestSpec[];
  /** Parse a checked-in, sanitized source response fixture; no source-specific guesses. */
  parseRaw(body: string, context: { route: string; date: string; url: string }): RawOffer[];
}

export interface CrawlSnapshot {
  schemaVersion: 1;
  source: string;
  fetchedAt: string;
  route: string;
  date: string;
  offers: RawOffer[];
}
