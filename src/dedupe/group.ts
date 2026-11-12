import type { FlightOffer, GroupIdentity, GroupProvider, OfferGroup } from "@/domain/flight";

/**
 * Grouping offers into **one physical flight, many prices**.
 *
 * The product promise: a user does not want "the cheapest of several different flights";
 * they want *this* flight — `Mahan W5 1084, 29 Aban, 17:45` — and its price at every source
 * that sells it. So identity comes before price, and it is established by evidence:
 *
 *   1. **Carrier + flight number** (the airline is in the code, so `IR 452` needs no extra
 *      key): the only identity we treat as fully trustworthy.
 *   2. **Carrier + route + day + departure within `SAME_DEPARTURE_TOLERANCE_MS`**: used
 *      *only* when no source published a number for either offer, and the resulting group
 *      says so (`identity: "same-departure"`) so the UI can label it.
 *
 * Deliberately never merged: two different flight numbers (even from the same carrier),
 * two different carriers at the same minute (codeshare is not assumed), two different days,
 * two different routes. Anything less than that would be comparing different tickets —
 * exactly the confusion this module exists to prevent.
 */

/**
 * Five minutes. A source quoting "13:00" and another "13:05" for the same flight is normal
 * (block-time rounding, a different airport's clock); "13:00" and "13:40" is not.
 */
export const SAME_DEPARTURE_TOLERANCE_MS = 5 * 60_000;

/**
 * The comparable form of a flight number: `IR-452`, `ir 452` and `IR452` are one flight.
 * Separate from the *displayed* number, which keeps the source's own formatting.
 */
export function normalizeFlightNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return compact.length >= 3 ? compact : null;
}

interface Cluster {
  flightNumber: string | null;
  departAtMs: number;
  offers: FlightOffer[];
}

export function groupOffers(offers: FlightOffer[]): OfferGroup[] {
  const buckets = new Map<string, FlightOffer[]>();
  for (const offer of offers) {
    const key = bucketKeyOf(offer);
    const list = buckets.get(key);
    if (list) list.push(offer);
    else buckets.set(key, [offer]);
  }

  const groups: OfferGroup[] = [];

  for (const bucket of buckets.values()) {
    const clusters: Cluster[] = [];

    // Numbered offers first: they define the clusters everyone else may join.
    const numbered = bucket.filter((offer) => Boolean(offer.flightNumber));
    const unnumbered = bucket.filter((offer) => !offer.flightNumber);

    for (const offer of numbered) {
      const number = normalizeFlightNumber(offer.flightNumber);
      if (!number) {
        unnumbered.push(offer);
        continue;
      }
      const match = clusters.find((cluster) => cluster.flightNumber === number);
      if (match) {
        match.offers.push(offer);
        match.departAtMs = Math.min(match.departAtMs, new Date(offer.departAt).getTime());
        continue;
      }
      clusters.push({
        flightNumber: number,
        departAtMs: new Date(offer.departAt).getTime(),
        offers: [offer],
      });
    }

    for (const offer of unnumbered) {
      const departAtMs = new Date(offer.departAt).getTime();
      // Only unnumbered clusters are candidates: an offer with no number may be the same
      // flight as a numbered one, but we do not claim that — it stays its own row.
      const match = clusters.find(
        (cluster) =>
          cluster.flightNumber === null && Math.abs(cluster.departAtMs - departAtMs) <= SAME_DEPARTURE_TOLERANCE_MS,
      );
      if (match) {
        match.offers.push(offer);
        continue;
      }
      clusters.push({ flightNumber: null, departAtMs, offers: [offer] });
    }

    for (const cluster of clusters) {
      const sorted = [...cluster.offers].sort(compareOffers);
      const primary = sorted[0];
      if (!primary) continue;

      const identity: GroupIdentity = cluster.flightNumber ? "flight-number" : "same-departure";
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
        // The displayed number comes from an actual source row, never from the normalised
        // key (which is only for matching).
        flightNumber: primary.flightNumber,
        identity,
        knownSellers: knownSellersOf(sorted),
      });
    }
  }

  return groups.sort(compareGroups);
}

/** Cheapest first; on a tie the flight that more sellers carry is the better answer. */
function compareGroups(a: OfferGroup, b: OfferGroup): number {
  if (a.cheapestToman !== b.cheapestToman) return a.cheapestToman - b.cheapestToman;
  if (b.knownSellers !== a.knownSellers) return b.knownSellers - a.knownSellers;
  return new Date(a.primary.departAt).getTime() - new Date(b.primary.departAt).getTime();
}

/** Carrier + route + departure day. Route and day are part of what a flight *is*. */
function bucketKeyOf(offer: FlightOffer): string {
  return `${offer.airlineCode}|${offer.originCode}>${offer.destinationCode}|${offer.departAt.slice(0, 10)}`;
}

/**
 * The canonical, human-inspectable group identity used everywhere (URLs included):
 *   `AIRLINE|FLIGHTNUMBER|YYYY-MM-DD|ORIGIN>DEST`
 * It is derived from the offer itself, so a group key in a URL always maps back to real
 * normalized data. Offers whose number no source published use `~`, which keeps their key
 * honest (and keeps them out of numbered groups).
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

/**
 * How many independent sellers we can *prove* offered this flight.
 *
 * Sepehr360 is one provider but prints "فروش توسط 125 سایت مختلف" per fare; that number is
 * a real fact about the offer and is counted here as a floor (max across offers, not a sum —
 * the same 125 sites appear on many rows). Unknown stays unknown: no seller count is
 * fabricated for offers that do not publish one.
 */
function knownSellersOf(offers: FlightOffer[]): number {
  let sellers = Math.max(1, new Set(offers.map((offer) => offer.providerId)).size);
  for (const offer of offers) {
    const declared = offer.provenance?.sellerCount ?? null;
    if (typeof declared === "number" && Number.isFinite(declared) && declared > 0) {
      sellers = Math.max(sellers, Math.round(declared));
    }
  }
  return sellers;
}

export function compareOffers(a: FlightOffer, b: FlightOffer): number {
  if (a.price.toman !== b.price.toman) return a.price.toman - b.price.toman;
  const freshness = new Date(b.providerUpdatedAt).getTime() - new Date(a.providerUpdatedAt).getTime();
  if (freshness !== 0) return freshness;
  return a.providerId.localeCompare(b.providerId);
}

/**
 * Safety net used by tests and the aggregator: a group must never contain offers that are
 * provably *different* flights. This is the invariant the whole comparison rests on.
 */
export function assertNoUnsafeMerge(groups: OfferGroup[]): void {
  for (const group of groups) {
    const numbers = new Set(
      group.offers.map((offer) => offer.flightNumber).filter((n): n is string => Boolean(n)),
    );
    if (numbers.size > 1) {
      throw new Error(`Unsafe merge in group ${group.groupKey}: ${[...numbers].join(", ")}`);
    }
    const days = new Set(group.offers.map((offer) => offer.departAt.slice(0, 10)));
    if (days.size > 1) {
      throw new Error(`Unsafe merge in group ${group.groupKey}: multiple days`);
    }
    const routes = new Set(group.offers.map((offer) => `${offer.originCode}>${offer.destinationCode}`));
    if (routes.size > 1) {
      throw new Error(`Unsafe merge in group ${group.groupKey}: multiple routes`);
    }
    const airlines = new Set(group.offers.map((offer) => offer.airlineCode));
    if (airlines.size > 1 || group.primary.airlineCode !== [...airlines][0]) {
      throw new Error(`Unsafe merge in group ${group.groupKey}: multiple carriers`);
    }
    if (!group.flightNumber) {
      // Unnumbered groups must at least *look* like one departure.
      const times = group.offers.map((offer) => new Date(offer.departAt).getTime());
      if (Math.max(...times) - Math.min(...times) > SAME_DEPARTURE_TOLERANCE_MS) {
        throw new Error(`Unsafe merge in group ${group.groupKey}: departures too far apart`);
      }
    }
  }
}
