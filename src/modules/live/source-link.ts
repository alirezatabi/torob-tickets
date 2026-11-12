/**
 * Where a "source" link may point.
 *
 * Two rules, both learned the hard way:
 *
 *   1. **Never render a link that goes nowhere.** Demo data used to carry
 *      `https://example.com/<provider>/flight/…&ref=…` URLs: a real, clickable anchor on
 *      the live page that opened a placeholder domain.
 *   2. **A live offer should actually take you to the source.** For a source we can
 *      navigate to (Sepehr360), the card links to our own redirect route
 *      (`/api/go/sepehr360`), which rebuilds the Jalali-dated search URL server-side and
 *      sends the user to the provider. That keeps URL construction out of client
 *      components and gives us one auditable hop per click.
 */

import { buildSearchUrl } from "@/modules/providers/sepehr360/url";

export type SourceLink =
  /** A page the user can open: our redirect hop, or the source's own URL. */
  | { kind: "external"; url: string; /** Open in a new tab (third-party site). */ blank: boolean }
  /** No public page exists for this offer; say why instead of faking a link. */
  | { kind: "none"; reason: string };

/** Hosts that exist only to mean "nowhere". Never rendered as a link. */
const PLACEHOLDER_HOSTS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "localhost",
  "127.0.0.1",
]);

function isPlaceholderHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  // "example" as a whole label never names a real provider, whatever the TLD.
  if (host === "example" || host.startsWith("example.")) return true;
  return (
    PLACEHOLDER_HOSTS.has(host) ||
    host.endsWith(".example") ||
    host.endsWith(".invalid") ||
    host.endsWith(".test")
  );
}

/** Sources we can redirect to, with the route that builds their search page. */
const REDIRECTABLE = new Set(["sepehr360"]);

export interface SourceLinkInput {
  offerUrl: string;
  /** `"demo"` offers are generated in-process and have no external page at all. */
  dataSource: "live" | "demo";
  providerId: string;
}

/** Minimal shape needed to rebuild the source's search URL. */
export interface OfferRoute {
  originCity: string;
  destinationCity: string;
  departAt: string;
  departTime?: string | null;
  airlineCode?: string | null;
}

export function sourceLinkFor({ offerUrl, dataSource, providerId }: SourceLinkInput): SourceLink {
  if (dataSource === "demo") {
    return { kind: "none", reason: "این نرخ ساختهٔ دادهٔ نمونه است و صفحه‌ای در منبع ندارد." };
  }

  let url: URL;
  try {
    url = new URL(offerUrl);
  } catch {
    return { kind: "none", reason: "منبع برای این نرخ آدرس عمومی ندارد." };
  }

  if (url.protocol !== "https:" || isPlaceholderHost(url.hostname)) {
    return { kind: "none", reason: "منبع برای این نرخ آدرس عمومی ندارد." };
  }
  // Amadeus is a B2B API: its flight-offer ids are not browsable pages.
  if (providerId === "amadeus") {
    return { kind: "none", reason: "Amadeus یک API سازمانی است و صفحهٔ عمومی برای این نرخ ندارد." };
  }

  return { kind: "external", url: url.toString(), blank: true };
}

/**
 * The "see it at the source" target for a live offer.
 *
 * Returns a **local** redirect path for sources we can rebuild a search URL for, so the
 * click is auditable and the destination is constructed from validated parts. Falls back to
 * the offer's own verified URL, or to no link at all.
 */
export function sourceRedirectFor(offer: SourceLinkInput & OfferRoute): SourceLink {
  const base = sourceLinkFor(offer);
  if (base.kind === "none") return base;

  if (!REDIRECTABLE.has(offer.providerId)) return base;

  const params = new URLSearchParams({
    origin: offer.originCity,
    destination: offer.destinationCity,
    date: offer.departAt.slice(0, 10),
  });
  const time = offer.departTime ?? offer.departAt.slice(11, 16);
  if (/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) params.set("time", time);
  if (offer.airlineCode && offer.airlineCode !== "??") params.set("airline", offer.airlineCode);

  // Guard: the redirect must be built from a URL the connector itself would produce.
  const expected = buildSearchUrl({
    originCity: offer.originCity,
    destinationCity: offer.destinationCity,
    departDate: offer.departAt.slice(0, 10),
  });
  if (!expected.url.startsWith("https://sepehr360.ir/")) return base;

  return { kind: "external", url: `/api/go/sepehr360?${params.toString()}`, blank: true };
}

/** The demo search page for an offer, so "go and compare it yourself" still works. */
export function demoSearchHref(offer: { originCity: string; destinationCity: string; departAt: string }): string {
  const params = new URLSearchParams({
    origin: offer.originCity,
    destination: offer.destinationCity,
    date: offer.departAt.slice(0, 10),
  });
  return `/search?${params.toString()}`;
}
