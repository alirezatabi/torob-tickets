import type { CrawlSource, RawOffer } from "../types";

const origin = "https://safarmarket.com";

/** Response shape is based on the user-provided, sanitized DevTools JSON fixture. */
export const safarmarketSource: CrawlSource = {
  id: "safarmarket",
  name: "Safarmarket",
  origin,
  buildRequests(query) {
    if (!/^[A-Z]{3}$/.test(query.originCode) || !/^[A-Z]{3}$/.test(query.destinationCode)
      || !/^\d{4}-\d{2}-\d{2}$/.test(query.departDate)
      || !Number.isInteger(query.passengers) || query.passengers < 1) {
      return [{ url: `${origin}/api/flight/v3/search`, method: "POST", body: null, blockedReason: "Invalid route, date, or adult passenger count." }];
    }
    // Use only the captured JSON payload fields. Client-specific IPInfo is kept null rather than
    // copying the redacted browser values; cookies, auth tokens and reCAPTCHA headers are never sent.
    const body = JSON.stringify({
      platform: "WEB_DESKTOP",
      uid: "",
      limit: 250,
      compress: false,
      productType: "LFLI",
      searchValidity: 2,
      cid: 1,
      checksum: 1,
      IPInfo: null,
      searchFilter: {
        // The captured request selected all classes; preserve both observed flags instead of inferring from query.cabin.
        sourceAirportCode: query.originCode,
        targetAirportCode: query.destinationCode,
        sourceIsCity: true,
        targetIsCity: true,
        leaveDate: query.departDate,
        returnDate: "",
        adultCount: query.passengers,
        childCount: 0,
        infantCount: 0,
        economy: true,
        business: true,
      },
    });
    return [{ url: `${origin}/api/flight/v3/search`, method: "POST", body }];
  },
  parseRaw(body, context): RawOffer[] {
    let decoded: unknown;
    try { decoded = JSON.parse(body); }
    catch { throw new Error("Safarmarket response is not valid JSON"); }
    const flights = getFlights(decoded);
    if (!flights) throw new Error("Safarmarket JSON is missing result.flights");

    const routeMatch = /^([A-Z]{3})-([A-Z]{3})$/.exec(context.route.toUpperCase());
    const output: RawOffer[] = [];
    for (const value of flights) {
      const flight = record(value);
      const leave = record(flight?.leave);
      const legs = Array.isArray(leave?.legs) ? leave.legs : [];
      const firstLeg = record(legs[0]);
      if (!flight || !leave) continue;

      const departureLocal = text(leave.departureTime) ?? text(firstLeg?.departureTime);
      const arrivalLocal = text(leave.arrivalTime) ?? text(firstLeg?.arrivalTime);
      const flightDate = departureLocal?.slice(0, 10) ?? null;
      if (context.date && flightDate !== context.date) continue;

      const originCode = text(firstLeg?.departureAirportCode);
      const destinationCode = text(firstLeg?.arrivalAirportCode);
      if (routeMatch && (originCode !== routeMatch[1] || destinationCode !== routeMatch[2])) continue;

      const airlineCode = text(leave.airlineCode) ?? text(firstLeg?.airlineCode);
      const flightNo = text(leave.flightNo) ?? text(firstLeg?.flightNo);
      const providers = Array.isArray(flight.providers) ? flight.providers : [];
      for (const providerValue of providers) {
        const provider = record(providerValue);
        if (!provider) continue;
        const amount = finiteNumber(provider.price);
        const providerStableId = text(provider.id) ?? text(provider.titleEn);
        const providerId = text(provider.titleEn) ?? text(provider.coreId) ?? providerStableId;
        const sourceFlightId = text(flight.flightId);
        const idParts = [sourceFlightId, flightNo, providerStableId].filter((part): part is string => part !== null);
        const rawId = idParts.length > 0 ? idParts.join(":") : null;
        const capacity = nonNegativeNumber(provider.outboundCapacity)
          ?? nonNegativeNumber(provider.capacity)
          ?? nonNegativeNumber(leave.capacity);
        output.push({
          id: rawId,
          origin: originCode,
          destination: destinationCode,
          // Safarmarket gives unzoned local wall times. Preserve them as source facts below,
          // and leave UTC instants null rather than assuming a timezone conversion.
          departAt: null,
          arriveAt: null,
          airline: text(leave.airlineName) ?? text(firstLeg?.airlineName),
          flightNumber: flightNo,
          amount,
          // The response excerpt does not state a currency code; do not infer rial/toman.
          currency: null,
          seats: capacity,
          // Provider URLs contain opaque booking/search identifiers; do not expose or persist them.
          offerUrl: null,
          departureLocal,
          arrivalLocal,
          airlineCode,
          airlineNameFa: text(leave.airlineNameFa) ?? text(firstLeg?.airlineNameFa),
          providerId,
          providerName: text(provider.title) ?? text(provider.titleEn),
          providerRecordId: providerStableId,
          flightId: text(flight.flightId),
          flightClass: text(flight.flightClass),
          sellType: text(leave.sellType),
          sourceDurationMinutes: nonNegativeNumber(leave.duration) ?? nonNegativeNumber(firstLeg?.flightDuration),
          aircraft: text(firstLeg?.airPlaneType),
          charter: typeof leave.charter === "boolean" ? leave.charter : null,
          stopsCount: nonNegativeNumber(leave.stopsCount),
          baggage: provider.outBoundBaggages ?? null,
          cancellationPolicies: provider.outBoundCancellationPolicies ?? null,
          sourceReservable: typeof provider.reservable === "boolean" ? provider.reservable : null,
          sourceKind: "safarmarket-api-response",
        });
      }
    }
    return output;
  },
};

function getFlights(value: unknown): unknown[] | null {
  const root = record(value);
  if (root?.code !== 200) return null;
  const result = record(root.result);
  return Array.isArray(result?.flights) ? result.flights : null;
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function finiteNumber(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function nonNegativeNumber(value: unknown): number | null { const number = finiteNumber(value); return number !== null && number >= 0 ? number : null; }
