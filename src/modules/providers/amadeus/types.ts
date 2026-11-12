/**
 * The subset of the Amadeus Flight Offers Search response we actually use.
 *
 * Written by hand from the official Self-Service API reference rather than generated,
 * so an unexpected field is ignored (never silently trusted) and every optional field
 * is explicitly optional.
 */

export interface AmadeusFlightEndpoint {
  iataCode: string;
  terminal?: string;
  /** Local wall clock without offset: "2026-11-20T08:40:00". */
  at: string;
}

export interface AmadeusSegment {
  departure: AmadeusFlightEndpoint;
  arrival: AmadeusFlightEndpoint;
  carrierCode: string;
  number: string;
  aircraft?: { code?: string };
  duration?: string;
  numberOfStops?: number;
}

export interface AmadeusItinerary {
  duration?: string;
  segments: AmadeusSegment[];
}

export interface AmadeusFee {
  amount: string;
  type: string;
}

export interface AmadeusPrice {
  currency: string;
  total: string;
  base?: string;
  grandTotal?: string;
  fees?: AmadeusFee[];
}

export interface AmadeusFareDetail {
  segmentId?: string;
  cabin?: string;
  fareBasis?: string;
  class?: string;
  fareType?: string;
  includedCheckedBags?: { quantity?: number; weight?: number; weightUnit?: string };
}

export interface AmadeusTravelerPricing {
  travelerId: string;
  travelerType?: string;
  fareOption?: string;
  fareDetailsBySegment?: AmadeusFareDetail[];
  price?: AmadeusPrice;
}

export interface AmadeusOffer {
  type?: string;
  id: string;
  source?: string;
  instantTicketingRequired?: boolean;
  nonHomogeneous?: boolean;
  lastTicketingDate?: string;
  numberOfBookableSeats?: number;
  itineraries: AmadeusItinerary[];
  price: AmadeusPrice;
  pricingOptions?: { fareType?: string[]; includedCheckedBagsOnly?: boolean };
  validatingAirlineCodes?: string[];
  travelerPricings?: AmadeusTravelerPricing[];
}

export interface AmadeusFlightOffersResponse {
  meta?: { count?: number };
  data?: AmadeusOffer[];
  dictionaries?: {
    carriers?: Record<string, string>;
    aircraft?: Record<string, string>;
    currencys?: Record<string, string>;
    location?: Record<string, { cityCode?: string; countryCode?: string }>;
  };
  errors?: { status?: number; code?: number; title?: string; detail?: string }[];
  warnings?: { code?: number; title?: string; detail?: string }[];
}

/** Response of `POST /v1/shopping/flight-offers/pricing`. */
export interface AmadeusPricingResponse {
  data?: {
    type?: string;
    flightOffers?: AmadeusOffer[];
  };
  dictionaries?: AmadeusFlightOffersResponse["dictionaries"];
  errors?: AmadeusFlightOffersResponse["errors"];
  warnings?: AmadeusFlightOffersResponse["warnings"];
}
