import type { CrawlSource, RawOffer } from "../types";

const endpoint = "https://ota.basisfly.com/v2/api/flight/lazysearch";
type Row = Record<string, unknown>;

/**
 * Basisfly response parser plus an opt-in template request builder. The operator
 * supplies the exact observed session-free JSON payload; validated route/date/
 * passenger placeholders are substituted without guessing the API field layout.
 * The parser accepts only values present in the response; it never derives a
 * booking URL or interprets timezone-less wall clocks as UTC.
 */
export const basisflySource: CrawlSource = {
  id: "basisfly",
  name: "Basisfly",
  origin: "https://ota.basisfly.com",
  buildRequests(query) {
    const valid = /^[A-Z]{3}$/.test(query.originCode) && /^[A-Z]{3}$/.test(query.destinationCode)
      && /^\d{4}-\d{2}-\d{2}$/.test(query.departDate) && Number.isInteger(query.passengers) && query.passengers > 0;
    if (!valid) return [{ url: endpoint, method: "POST", body: null, blockedReason: "Invalid route, date, or passenger count." }];
    try {
      const ids = locationIdsFromEnv();
      const originId = ids.get(query.originCode); const destinationId = ids.get(query.destinationCode);
      if (!originId || !destinationId) throw new Error(`No verified Basisfly numeric location ID configured for ${!originId ? query.originCode : query.destinationCode}`);
      const template = process.env.BASISFLY_REQUEST_TEMPLATE;
      if (!template) throw new Error("Set BASISFLY_REQUEST_TEMPLATE to the observed session-free JSON request, using {{ORIGIN_ID}}, {{DESTINATION_ID}}, {{DATE}}, {{PASSENGERS}}, and {{CABIN}} placeholders as needed.");
      const secretTorob = process.env.SECRET_TOROB?.trim();
      if (!secretTorob) throw new Error("Set SECRET_TOROB in the local .env file; its value is sent only as the Basisfly SECRET_TOROB request header.");
      const parsed: unknown = JSON.parse(template);
      if (!row(parsed)) throw new Error("BASISFLY_REQUEST_TEMPLATE must be a JSON object");
      assertNoCredentials(parsed);
      const serializedTemplate = JSON.stringify(parsed);
      for (const required of ["{{ORIGIN_ID}}", "{{DESTINATION_ID}}", "{{DATE}}", "{{PASSENGERS}}"] as const) {
        if (!serializedTemplate.includes(required)) throw new Error(`BASISFLY_REQUEST_TEMPLATE must contain ${required} so the worker cannot replay a fixed search.`);
      }
      const body = substituteTemplate(parsed, {
        "{{ORIGIN_ID}}": originId, "{{DESTINATION_ID}}": destinationId,
        "{{DATE}}": query.departDate, "{{PASSENGERS}}": query.passengers, "{{CABIN}}": query.cabin,
      });
      return [{ url: endpoint, method: "POST", body: JSON.stringify(body), headers: { SECRET_TOROB: secretTorob } }];
    } catch (error) {
      return [{ url: endpoint, method: "POST", body: null, blockedReason: error instanceof Error ? error.message : "Basisfly request template is invalid." }];
    }
  },
  parseRaw(body, context) {
    let decoded: unknown;
    try { decoded = JSON.parse(body); }
    catch { throw new Error("Basisfly response is not valid JSON"); }
    const root = Array.isArray(decoded) ? { sources: decoded } : row(decoded);
    if (!root) throw new Error("Basisfly response root is not an object or wrapper array");

    const locationCodes = buildLocationCodes(root);
    const proposals = findProposals(root);
    const route = /^([A-Z]{3})-([A-Z]{3})$/i.exec(context.route);
    const output: RawOffer[] = [];
    for (const proposal of proposals) {
      const proposalId = text(proposal.FlightId) ?? text(proposal.Id) ?? text(proposal.ProposalId);
      const groups = array(proposal.FlightGroup);
      // A proposal can carry multiple flight groups; keep them distinct rather than
      // flattening legs from alternate itineraries into one offer.
      for (const [groupIndex, groupValue] of groups.entries()) {
        const group = row(groupValue);
        if (!group) continue;
        const routes = findRoutes(group) ?? findRoutes(proposal);
        if (!routes?.length) continue;
        const segments = routes.map((routeValue) => routeSegment(row(routeValue), locationCodes));
        if (segments.some((segment) => !segment)) continue;
        const legs = segments as NonNullable<(typeof segments)[number]>[];
        const first = legs[0]!; const last = legs[legs.length - 1]!;
        if (route && (first.origin !== route[1]!.toUpperCase() || last.destination !== route[2]!.toUpperCase())) continue;
        const dates = legs.map((leg) => leg.departureLocal?.slice(0, 10)).filter((value): value is string => !!value);
        if (context.date && dates.length && dates[0] !== context.date) continue;

        const priceInfo = row(group.PriceInfo) ?? row(proposal.PriceInfo) ?? findNestedRow(group, "PriceInfo") ?? findNestedRow(proposal, "PriceInfo");
        const amount = finiteNumber(priceInfo?.Total);
        const currency = currencyCode(priceInfo?.Currency);
        if (amount === null || amount <= 0) continue;
        const baggageValues = array(group.Baggages).length ? array(group.Baggages) : array(proposal.Baggages);
        const baggage = baggageValues.map((value) => {
          const item = row(value);
          return item ? { passengerType: text(item.PassengerType), pieces: finiteNumber(item.Pieces), weight: finiteNumber(item.Weight), unit: text(item.Unit) } : null;
        }).filter((item) => item !== null);
        const provider = row(group.Provider) ?? row(proposal.Provider);
        const airline = text(first.airlineCode) ?? text(provider?.Name) ?? text(provider?.name);
        const flightNumber = legs.map((leg) => leg.flightNumber).filter((value): value is string => !!value).join("/") || null;
        const seats = finiteNumber(group.AvailableSeats) ?? finiteNumber(proposal.AvailableSeats);
        const refundable = bool(group.Refundable) ?? bool(proposal.Refundable);
        const rawId = [proposalId, text(group.GroupId) ?? text(group.Id) ?? String(groupIndex)].filter(Boolean).join(":");
        output.push({
          id: rawId || null,
          origin: first.origin,
          destination: last.destination,
          departAt: first.departAt,
          arriveAt: last.arriveAt,
          airline,
          airlineCode: first.airlineCode,
          flightNumber,
          amount,
          currency,
          seats: seats !== null && seats >= 0 ? seats : null,
          offerUrl: null,
          sourceSegments: legs.map((leg) => ({
            originCode: leg.origin, destinationCode: leg.destination, airlineCode: leg.airlineCode,
            flightNumber: leg.flightNumber, departureLocal: leg.departureLocal, arrivalLocal: leg.arrivalLocal,
            departAt: leg.departAt, arriveAt: leg.arriveAt, aircraft: leg.aircraft,
          })),
          baggage,
          refundable,
          providerName: text(provider?.Name) ?? text(provider?.name),
          sourceCurrency: currency,
          sourceFlightId: proposalId,
          fareClass: text(group.FareClass) ?? text(proposal.FareClass),
          stopsCount: legs.length - 1,
          sourceKind: "basisfly-lazysearch-response",
        });
      }
    }
    return output;
  },
};

interface ParsedSegment {
  origin: string; destination: string; airlineCode: string | null; flightNumber: string | null;
  departureLocal: string | null; arrivalLocal: string | null; departAt: string | null; arriveAt: string | null; aircraft: string | null;
}
function routeSegment(value: Row | null, locations: Map<string, string>): ParsedSegment | null {
  if (!value) return null;
  const origin = airportCode(value.Origin ?? value.OriginCode ?? value.From ?? value.Departure, locations);
  const destination = airportCode(value.Destination ?? value.DestinationCode ?? value.To ?? value.Arrival, locations);
  if (!origin || !destination) return null;
  const departure = text(value.DepartureDateTime) ?? text(value.DepartureTime) ?? text(value.DepartureDate) ?? text(value.Departure);
  const arrival = text(value.ArrivalDateTime) ?? text(value.ArrivalTime) ?? text(value.ArrivalDate) ?? text(value.Arrival);
  return {
    origin, destination,
    airlineCode: text(value.AirlineCode) ?? text(value.CarrierCode) ?? text(value.Airline),
    flightNumber: text(value.FlightNumber) ?? text(value.FlightNo) ?? text(value.Number),
    departureLocal: departure, arrivalLocal: arrival,
    departAt: explicitInstant(departure), arriveAt: explicitInstant(arrival),
    aircraft: text(value.Aircraft) ?? text(value.AircraftType),
  };
}
function findProposals(root: Row): Row[] {
  const result: Row[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    const item = row(value); if (!item) return;
    const proposals = item.FlightProposals;
    if (Array.isArray(proposals)) {
      for (const proposal of proposals) { const parsed = row(proposal); if (parsed) result.push(parsed); }
      return;
    }
    // Basisfly can wrap the result in one or more `sources` / `data` arrays.
    for (const key of ["sources", "data", "result"]) if (key in item) visit(item[key]);
  };
  visit(root);
  return result;
}
function findRoutes(value: Row): unknown[] | null {
  const direct = value.RoutesInfo;
  if (Array.isArray(direct)) return direct;
  if (row(direct)) {
    const nested = row(direct)!;
    for (const key of ["Routes", "Route", "Items", "Segments"]) if (Array.isArray(nested[key])) return nested[key] as unknown[];
    return [direct];
  }
  return null;
}
function buildLocationCodes(root: Row): Map<string, string> {
  const result = new Map<string, string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    const item = row(value); if (!item) return;
    const code = text(item.IataCode) ?? text(item.IATACode) ?? text(item.Code) ?? text(item.code);
    const id = scalarText(item.Id) ?? scalarText(item.ID) ?? scalarText(item.id) ?? scalarText(item.LocationId);
    if (code && /^[A-Z]{3}$/i.test(code) && id) result.set(id, code.toUpperCase());
    for (const [key, child] of Object.entries(item)) {
      const childRow = row(child);
      const childCode = childRow ? text(childRow.IataCode) ?? text(childRow.IATACode) ?? text(childRow.Code) ?? text(childRow.code) : null;
      if (/^\d+$/.test(key) && childCode && /^[A-Z]{3}$/i.test(childCode)) result.set(key, childCode.toUpperCase());
      if (childRow && code && /^[A-Z]{3}$/i.test(code) && !result.has(key)) result.set(key, code.toUpperCase());
      visit(child);
    }
  };
  visit(root);
  return result;
}
function airportCode(value: unknown, locations: Map<string, string>): string | null {
  const textValue = typeof value === "number" ? String(value) : text(value);
  if (!textValue) return null;
  if (/^[A-Z]{3}$/i.test(textValue)) return textValue.toUpperCase();
  if (row(value)) {
    const item = row(value)!;
    const code = text(item.IataCode) ?? text(item.IATACode) ?? text(item.Code) ?? text(item.code);
    if (code && /^[A-Z]{3}$/i.test(code)) return code.toUpperCase();
    const id = scalarText(item.Id) ?? scalarText(item.ID) ?? scalarText(item.id);
    return id ? locations.get(id) ?? null : null;
  }
  return locations.get(textValue) ?? null;
}
function explicitInstant(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function findNestedRow(value: Row, key: string): Row | null {
  for (const child of Object.values(value)) {
    const item = row(child); if (!item) continue;
    if (key in item) return row(item[key]);
    const nested = findNestedRow(item, key); if (nested) return nested;
  }
  return null;
}
function currencyCode(value: unknown): string | null {
  const raw = typeof value === "string" ? value : row(value) ? text(row(value)!.Code) ?? text(row(value)!.code) ?? text(row(value)!.CurrencyCode) : null;
  return raw?.trim().toUpperCase() ?? null;
}
function row(value: unknown): Row | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function scalarText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}
function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return null;
}
function bool(value: unknown): boolean | null { return typeof value === "boolean" ? value : null; }

function locationIdsFromEnv(): Map<string, number> {
  const ids = new Map<string, number>([["MHD", 1211083], ["THR", 1203548]]);
  const configured = process.env.BASISFLY_LOCATION_IDS?.trim();
  if (!configured) return ids;
  for (const entry of configured.split(",")) {
    const match = /^\s*([A-Z]{3})\s*:\s*(\d+)\s*$/.exec(entry.toUpperCase());
    if (!match) throw new Error(`Invalid BASISFLY_LOCATION_IDS entry: ${entry}; expected IATA:numericId`);
    const id = Number(match[2]);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Invalid Basisfly location ID for ${match[1]}`);
    ids.set(match[1]!, id);
  }
  return ids;
}
function assertNoCredentials(value: unknown): void {
  if (Array.isArray(value)) { for (const item of value) assertNoCredentials(item); return; }
  const item = row(value); if (!item) return;
  for (const [key, child] of Object.entries(item)) {
    if (/session.?id|cookie|token|authorization|auth.?header|secret/i.test(key)) {
      throw new Error(`Remove credential-like field ${key} from BASISFLY_REQUEST_TEMPLATE; the crawler sends no session or browser credentials.`);
    }
    assertNoCredentials(child);
  }
}
function substituteTemplate(value: unknown, replacements: Record<string, string | number>): unknown {
  if (Array.isArray(value)) return value.map((item) => substituteTemplate(item, replacements));
  const item = row(value);
  if (item) return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, substituteTemplate(child, replacements)]));
  if (typeof value !== "string") return value;
  if (value in replacements) return replacements[value];
  return Object.entries(replacements).reduce((textValue, [placeholder, replacement]) => textValue.replaceAll(placeholder, String(replacement)), value);
}
