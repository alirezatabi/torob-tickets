import type { CrawlSource, CrawlSourceId, RawOffer } from "../types";

export function placeholderSource(id: CrawlSourceId, name: string, origin: string): CrawlSource {
  return {
    id, name, origin,
    buildRequests() { throw new Error("NOT_IMPLEMENTED: نیاز به fixture واقعی"); },
    parseRaw(_html: string, _context: { route: string; date: string; url: string }): RawOffer[] {
      throw new Error("NOT_IMPLEMENTED: نیاز به fixture واقعی");
    },
  };
}
