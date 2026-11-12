import type { FlightOffer, OfferGroup, GroupProvider } from "@/domain/flight";

/**
 * Cross-provider deduplication.
 *
 * Two offers describe the same physical flight when they share:
 *   • airline + route + departure **day** (at the origin airport), and either
 *   • the same flight number, or
 *   • (one side has no flight number) a departure time within 30 minutes.
 *
 * Price, provider and currency are deliberately excluded, so:
 *   • one flight sold by 3 providers becomes ONE group with 3 prices, and
 *   • two different flights with a similar price are never merged.
 */

const NO_FLIGHT_NUMBER_TOLERANCE_MS = 30 * 60_000;

interface Cluster {
  key: string;
  airline: string;
  day: string;
  route: string;
  flightNumber: string | null;
  departAt: string;
  offers: FlightOffer[];
}

export function groupOffers(offers: FlightOffer[]): OfferGroup[] {
  // Bucket by airline + route + departure day first; identity inside the bucket is
  // decided by flight number, with a guarded time-based fallback.
  const buckets = new Map<string, FlightOffer[]>();
  for (const offer of offers) {
    const bucketKey = bucketKeyOf(offer);
    const list = buckets.get(bucketKey);
    if (list) list.push(offer);
    else buckets.set(bucketKey, [offer]);
  }

  const groups: OfferGroup[] = [];

  for (const bucket of buckets.values()) {
    const clusters: Cluster[] = [];

    for (const offer of bucket) {
      const flightNumber = offer.flightNumber;
      const match = flightNumber
        ? clusters.find((cluster) => cluster.flightNumber === flightNumber)
        : findClusterWithoutNumber(clusters, offer);

      if (match) {
        match.offers.push(offer);
        match.flightNumber ??= flightNumber;
        continue;
      }

      clusters.push({
        key: `cluster-${clusters.length}-${bucketKeyOf(offer)}`,
        airline: offer.airlineCode,
        day: offer.departAt.slice(0, 10),
        route: `${offer.originCode}>${offer.destinationCode}`,
        flightNumber,
        departAt: offer.departAt,
        offers: [offer],
      });
    }

    for (const cluster of clusters) {
      const sorted = [...cluster.offers].sort(compareOffers);
      const primary = sorted[0];
      if (!primary) continue;
      // Group identity comes from the (canonical) flight, never from the raw cluster.
      const key = canonicalGroupKey(primary);

      for (const offer of sorted) offer.groupKey = key;

      const providers = cheapestPerProvider(sorted);
      const cheapestToman = providers[0]?.priceToman ?? primary.price.toman;
      const highest = providers[providers.length - 1]?.priceToman ?? cheapestToman;

      groups.push({
        groupKey: key,
        primary,
        offers: sorted,
        cheapestToman,
        providers,
        hasPriceSpread: highest - cheapestToman >= Math.max(50_000, cheapestToman * 0.02),
      });
    }
  }

  return groups.sort((a, b) => a.cheapestToman - b.cheapestToman);
}

function bucketKeyOf(offer: FlightOffer): string {
  return `${offer.airlineCode}|${offer.originCode}>${offer.destinationCode}|${offer.departAt.slice(0, 10)}`;
}

/**
 * The canonical, human-inspectable group identity used everywhere (URLs included):
 *   `AIRLINE|FLIGHTNUMBER|YYYY-MM-DD|ORIGIN>DEST`
 * It is derived from the offer itself, so a group key in a URL always maps back to
 * real normalized data.
 */
export function canonicalGroupKey(offer: {
  airlineCode: string;
  flightNumber: string | null;
  departAt: string;
  originCode: string;
  destinationCode: string;
}): string {
  const day = offer.departAt.slice(0, 10);
  const number = offer.flightNumber?.replace(/[^A-Z0-9]/gi, "").toUpperCase() ?? "~";
  return `${offer.airlineCode}|${number}|${day}|${offer.originCode}>${offer.destinationCode}`;
}

/** True when a URL token looks like a group key rather than an offer id. */
export function isGroupKey(value: string): boolean {
  return /\|.*\|\d{4}-\d{2}-\d{2}\|/.test(value);
}

/** Join an unnumbered offer to a cluster whose departure is within 30 minutes. */
function findClusterWithoutNumber(clusters: Cluster[], offer: FlightOffer): Cluster | undefined {
  const departAt = new Date(offer.departAt).getTime();
  return clusters.find((cluster) => {
    if (hasConflictingNumbers(cluster, offer)) return false;
    return Math.abs(new Date(cluster.departAt).getTime() - departAt) <= NO_FLIGHT_NUMBER_TOLERANCE_MS;
  });
}

/** Never attach an unnumbered offer to a cluster that already holds a different number. */
function hasConflictingNumbers(cluster: Cluster, offer: FlightOffer): boolean {
  if (!offer.flightNumber) return false;
  return cluster.flightNumber !== null && cluster.flightNumber !== offer.flightNumber;
}

/** One provider row per group, using the cheapest quote that provider offers. */
function cheapestPerProvider(sorted: FlightOffer[]): GroupProvider[] {
  const cheapest = new Map<string, FlightOffer>();
  for (const offer of sorted) {
    if (!cheapest.has(offer.providerId)) cheapest.set(offer.providerId, offer);
  }
  return [...cheapest.values()].map((offer) => ({
    providerId: offer.providerId,
    providerName: offer.providerName,
    priceToman: offer.price.toman,
    offerId: offer.id,
    offerUrl: offer.offerUrl,
    original: offer.price.original,
    converted: offer.price.converted,
  }));
}

export function compareOffers(a: FlightOffer, b: FlightOffer): number {
  if (a.price.toman !== b.price.toman) return a.price.toman - b.price.toman;
  const freshness = new Date(b.providerUpdatedAt).getTime() - new Date(a.providerUpdatedAt).getTime();
  if (freshness !== 0) return freshness;
  return a.providerId.localeCompare(b.providerId);
}

/**
 * Safety net used by tests and the aggregator: a group must never contain two
 * offers that are provably different flights.
 */
export function assertNoUnsafeMerge(groups: OfferGroup[]): void {
  for (const group of groups) {
    const numbers = new Set(group.offers.map((offer) => offer.flightNumber).filter((n): n is string => Boolean(n)));
    if (numbers.size > 1) {
      throw new Error(`Unsafe merge in group ${group.groupKey}: ${[...numbers].join(", ")}`);
    }
    const days = new Set(group.offers.map((offer) => offer.departAt.slice(0, 10)));
    if (days.size > 1) {
      throw new Error(`Unsafe merge in group ${group.groupKey}: multiple days`);
    }
  }
}
