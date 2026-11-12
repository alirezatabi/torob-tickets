/**
 * Where a "source" link may point.
 *
 * The rule this file enforces: **the UI must never offer a clickable link that goes
 * nowhere.** Demo data used to carry `https://example.com/<provider>/flight/…&ref=…`
 * URLs: a real, clickable anchor on the live page that opened a placeholder domain. That
 * is worse than no link — it looks like a booking route and it is not one.
 *
 * So a link is only rendered when the offer comes from a live source *and* the URL is an
 * absolute `https` URL on a public host. Everything else is rendered as text.
 */

export type SourceLink =
  /** A real page the user can open (the live source's own search page). */
  | { kind: "external"; url: string }
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
  return PLACEHOLDER_HOSTS.has(host) || host.endsWith(".example") || host.endsWith(".invalid") || host.endsWith(".test");
}

export interface SourceLinkInput {
  offerUrl: string;
  /** `"demo"` offers are generated in-process and have no external page at all. */
  dataSource: "live" | "demo";
  providerId: string;
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

  if (url.protocol !== "https:") {
    return { kind: "none", reason: "منبع برای این نرخ آدرس عمومی ندارد." };
  }
  if (isPlaceholderHost(url.hostname)) {
    return { kind: "none", reason: "منبع برای این نرخ آدرس عمومی ندارد." };
  }
  // Amadeus is a B2B API: its flight-offer ids are not browsable pages.
  if (providerId === "amadeus") {
    return { kind: "none", reason: "Amadeus یک API سازمانی است و صفحهٔ عمومی برای این نرخ ندارد." };
  }

  return { kind: "external", url: url.toString() };
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
