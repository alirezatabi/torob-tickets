import { describe, expect, it } from "vitest";

import { demoSearchHref, sourceLinkFor } from "@/modules/live/source-link";
import { demoOfferUrl } from "@/providers/fixtures";

/**
 * The rule under test: the UI may only render a clickable source link when the offer has
 * a real, live, public page. Anything else must degrade to text.
 *
 * Regression: demo offers carried `https://example.com/...&ref=torob-tickets-demo`, which
 * rendered as a working "منبع" button on `/live` pointing at a placeholder domain.
 */
describe("sourceLinkFor", () => {
  it("refuses the demo placeholder URL that used to be rendered as a link", () => {
    const link = sourceLinkFor({
      offerUrl: "https://example.com/pars/flight/thr-mhd-zv-652?date=2026-11-20&ref=torob-tickets-demo",
      dataSource: "live",
      providerId: "pars",
    });
    expect(link.kind).toBe("none");
  });

  it("refuses any demo offer, even with a plausible external URL", () => {
    const link = sourceLinkFor({
      offerUrl: "https://sepehr360.ir/Flight/B2c/Search?origin=THR",
      dataSource: "demo",
      providerId: "sepehr360",
    });
    expect(link.kind).toBe("none");
    if (link.kind === "none") expect(link.reason).toContain("نمونه");
  });

  it("accepts a real live provider page", () => {
    const url = "https://sepehr360.ir/Flight/B2c/Search?origin=THR&destination=MHD&departureDate=1405-08-22";
    expect(sourceLinkFor({ offerUrl: url, dataSource: "live", providerId: "sepehr360" })).toEqual({
      kind: "external",
      url,
    });
  });

  it("never links to Amadeus, which has no browsable fare page", () => {
    const link = sourceLinkFor({
      offerUrl: "https://test.api.amadeus.com/v2/shopping/flight-offers/1",
      dataSource: "live",
      providerId: "amadeus",
    });
    expect(link.kind).toBe("none");
    if (link.kind === "none") expect(link.reason).toContain("Amadeus");
  });

  it.each([
    ["placeholder .test host", "https://provider.test/flight/1"],
    ["placeholder .invalid host", "https://provider.invalid/flight/1"],
    ["insecure http", "http://sepehr360.ir/Flight/B2c/Search"],
    ["relative URL", "/search?origin=THR"],
    ["empty string", ""],
  ])("refuses %s", (_label, offerUrl) => {
    expect(sourceLinkFor({ offerUrl, dataSource: "live", providerId: "sepehr360" }).kind).toBe("none");
  });
});

describe("demo pipeline", () => {
  it("emits an in-app link, not an external placeholder domain", () => {
    const url = demoOfferUrl("pars", "thr-mhd-zv-652", "2026-11-20");
    expect(url.startsWith("/")).toBe(true);
    expect(url).not.toContain("example.com");
  });

  it("gives a demo offer a working in-app comparison link", () => {
    const href = demoSearchHref({
      originCity: "THR",
      destinationCity: "MHD",
      departAt: "2026-11-20T06:40:00.000Z",
    });
    expect(href).toBe("/search?origin=THR&destination=MHD&date=2026-11-20");
  });
});
