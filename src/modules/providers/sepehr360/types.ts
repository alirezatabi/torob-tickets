/**
 * Raw record shape for the Sepehr360 HTML connector.
 *
 * It mirrors one *result card* on the search page — nothing more. In particular it
 * has no flight number, no aircraft and no per-offer URL, because the page does not
 * publish them; inventing fields here would be the shortest path to fabricated data.
 */

export interface Sepehr360RawOffer {
  /** Stable per-page index, used only for logging/rejection messages. */
  index: number;
  /** Airline code derived from the logo URL, when resolvable. */
  airlineCode: string | null;
  /** Airline name exactly as printed on the page. */
  airlineNameFa: string | null;
  /** "05:30" wall clock at the origin airport. */
  departTime: string | null;
  /** "07:15" wall clock at the destination airport. */
  arriveTime: string | null;
  /** Raw Persian duration text ("۱ ساعت و ۳۰ دقیقه"), often empty. */
  durationText: string | null;
  /** Price text exactly as printed, Persian digits included. */
  priceText: string | null;
  /** Price as an integer in the page's stated unit (toman). */
  priceAmount: number | null;
  /** IATA origin/destination printed by a JSON feed (the HTML cards print names only). */
  originAirportCode?: string | null;
  destinationAirportCode?: string | null;
  /** Persian origin label ("از مهرآباد"). */
  originLabel: string | null;
  /** Persian destination label ("به مشهد"). */
  destinationLabel: string | null;
  /** "اکونومی" / "بیزنس" as printed, or null. */
  cabinLabel: string | null;
  /** "مستقیم" / "یک توقف" / … as printed. */
  stopsLabel: string | null;
  /** Agency count text ("فروش توسط 128 سایت") or a single seller name. */
  sellerText: string | null;
  /** Seat/availability text when the page shows one. */
  availabilityText: string | null;
  /** Whether the card says the flight is a charter ("چارتر"). */
  charterHint: boolean;
  /**
   * Flight number, only when the source itself printed one. The HTML cards do not; the
   * site's own JSON feed does, so the field is optional and null means "not published".
   */
  flightNumber?: string | null;
  /** Number of stops the source states, when the feed publishes a count. */
  stopsCount?: number | null;
  /** Seats the source states are left, when the feed publishes a count. */
  seatsAvailable?: number | null;
  /**
   * Where this record came from. Used to say *one* true thing about the row: a value read
   * from the source's JSON feed is data the page displayed to a browser; a value read from
   * the rendered HTML is data printed in the document.
   */
  origin?: "html" | "json";
}

export interface Sepehr360PageMeta {
  /** Result count the page states ("23 نتیجه"). */
  resultCount: number | null;
  /** The site's own "last updated" text, when present. */
  updatedText: string | null;
  /** Airport codes from the page's own origin/destination fields, when present. */
  originAirport: string | null;
  destinationAirport: string | null;
  /** True when the page rendered an explicit "no results" state. */
  emptyState: boolean;
  /** True when the page looks like a challenge/consent wall rather than results. */
  challenge: string | null;
}

export interface Sepehr360ParseResult {
  offers: Sepehr360RawOffer[];
  meta: Sepehr360PageMeta;
  /** Structural problems worth reporting (missing selectors after a site change). */
  warnings: string[];
}
