import { describe, expect, it } from "vitest";
import { parseSearchParams, toSearchParams, searchHref } from "@/lib/search-params";
import { filterGroups, priceBounds, airlineOptions } from "@/lib/filter";
import { groupOffers } from "@/dedupe/group";
import { runSearch } from "@/providers/search";
import { createQuery } from "@/domain/trip";

const defaults = { date: "2026-11-20" };

describe("search parameters", () => {
  it("accepts a complete, valid query", () => {
    const result = parseSearchParams(
      { origin: "thr", destination: "ist", date: "2026-11-20", stops: "0", bag: "1", price: "low", pax: "2" },
      defaults,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.originCode).toBe("THR");
    expect(result.query.passengers).toBe(2);
    expect(result.query.filters.maxStops).toBe(0);
    expect(result.query.filters.baggageRequired).toBe(true);
    expect(result.query.filters.pricePreference).toBe("low");
  });

  it("reports which essentials are missing", () => {
    // `date` is no longer an essential: the product searches "today" by default (B1).
    const result = parseSearchParams({ origin: "THR" }, defaults);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toEqual(["destination"]);
  });

  it("searches today in Tehran when no date is given", () => {
    const result = parseSearchParams({ origin: "IFN", destination: "KIH" }, { now: new Date("2026-11-20T09:00:00Z") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.departDate).toBe("2026-11-20");
    expect(result.query.passengers).toBe(1);
    expect(result.query.cabin).toBe("economy");
  });

  it("rejects an impossible calendar date with a Persian reason instead of returning nothing", () => {
    const impossible = parseSearchParams({ origin: "THR", destination: "IST", date: "2026-13-45" }, defaults);
    expect(impossible.ok).toBe(false);
    if (impossible.ok) return;
    expect(impossible.invalid).toBe("date");
    expect(impossible.reason).toContain("وجود ندارد");

    const malformed = parseSearchParams({ origin: "THR", destination: "IST", date: "20-11-2026" }, defaults);
    expect(malformed.ok).toBe(false);
    if (malformed.ok) return;
    expect(malformed.reason).toContain("قالب درست");
  });

  it("rejects a departure date in the past", () => {
    const result = parseSearchParams(
      { origin: "THR", destination: "IST", date: "2026-11-19" },
      { now: new Date("2026-11-20T09:00:00Z") },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("گذشته");
  });

  it("rejects unknown airports rather than guessing", () => {
    const result = parseSearchParams({ origin: "ZZZ", destination: "IST", date: "2026-11-20" }, defaults);
    expect(result.ok).toBe(false);
  });

  it("rejects identical origin and destination", () => {
    const result = parseSearchParams({ origin: "IST", destination: "IST", date: "2026-11-20" }, defaults);
    expect(result.ok).toBe(false);
  });

  it("clamps hostile values into range", () => {
    const result = parseSearchParams(
      { origin: "THR", destination: "IST", date: "2026-11-20", pax: "999", stops: "-4" },
      defaults,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.passengers).toBe(9);
    expect(result.query.filters.maxStops).toBe(0);
  });

  it("round-trips through the URL representation", () => {
    const query = createQuery({
      originCode: "THR",
      destinationCode: "IST",
      departDate: "2026-11-20",
      passengers: 2,
      filters: {
        dataSource: "real",
        pricePreference: "low",
        maxStops: 0,
        baggageRequired: true,
        refundableOnly: false,
        dayPart: "morning",
        maxPriceToman: 4_000_000,
        preferredAirlines: ["W5"],
      },
    });
    const params = toSearchParams(query);
    const reparsed = parseSearchParams(Object.fromEntries(params.entries()), defaults);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.query.filters).toEqual(query.filters);
    expect(reparsed.query.passengers).toBe(2);
  });

  it("builds links that keep the filter state", () => {
    const query = createQuery({ originCode: "THR", destinationCode: "IST", departDate: "2026-11-20" });
    expect(searchHref(query, { stops: "0" })).toContain("stops=0");
    expect(searchHref(query, { sort: "cheapest" })).toContain("sort=cheapest");
  });
});

describe("display filters over real results", () => {
  const query = createQuery({ originCode: "THR", destinationCode: "IST", departDate: "2026-11-20" });

  it("filters by stops and baggage, and reports how many groups were hidden", async () => {
    const outcome = await runSearch(query);
    const groups = groupOffers(outcome.offers);

    const all = filterGroups(groups, query.filters);
    expect(all.hidden).toBe(0);
    expect(all.visible).toHaveLength(groups.length);

    const directWithBag = filterGroups(groups, { ...query.filters, maxStops: 0, baggageRequired: true });
    expect(directWithBag.visible.length).toBeGreaterThan(0);
    expect(directWithBag.visible.length).toBeLessThan(groups.length);
    for (const group of directWithBag.visible) {
      expect(group.offers.every((offer) => offer.stops === 0 && offer.baggage.checked === "included")).toBe(true);
    }
  });

  it("applies a price cap on the cheapest provider price", async () => {
    const outcome = await runSearch(query);
    const groups = groupOffers(outcome.offers);
    const bounds = priceBounds(groups);
    const cap = bounds.min + Math.round((bounds.max - bounds.min) / 3);

    const filtered = filterGroups(groups, { ...query.filters, maxPriceToman: cap });
    expect(filtered.visible.every((group) => group.cheapestToman <= cap)).toBe(true);
  });

  it("lists airline options with counts", async () => {
    const outcome = await runSearch(query);
    const groups = groupOffers(outcome.offers);
    const options = airlineOptions(groups);
    expect(options.length).toBeGreaterThan(2);
    expect(options.reduce((sum, option) => sum + option.count, 0)).toBe(groups.length);
  });
});
