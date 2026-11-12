import { describe, expect, it } from "vitest";

import { demoSearchHref, sourceLinkFor, sourceRedirectFor } from "@/modules/live/source-link";
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
      blank: true,
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

describe("sourceRedirectFor", () => {
  const liveSepehr = {
    offerUrl: "https://sepehr360.ir/Flight/B2c/Search?origin=THR&destination=MHD&departureDate=1405-08-29",
    dataSource: "live" as const,
    providerId: "sepehr360",
    originCity: "THR",
    destinationCity: "MHD",
    departAt: "2026-11-20T04:00:00.000Z",
    departTime: "04:00",
    airlineCode: "IR",
  };

  it("sends a live Sepehr360 offer through our auditable redirect", () => {
    const link = sourceRedirectFor(liveSepehr);
    expect(link.kind).toBe("external");
    if (link.kind !== "external") return;
    expect(link.url.startsWith("/api/go/sepehr360?")).toBe(true);
    const params = new URL(link.url, "http://x").searchParams;
    expect(params.get("origin")).toBe("THR");
    expect(params.get("destination")).toBe("MHD");
    expect(params.get("date")).toBe("2026-11-20");
    expect(params.get("time")).toBe("04:00");
    expect(params.get("airline")).toBe("IR");
  });

  it("does not send a demo offer anywhere", () => {
    expect(sourceRedirectFor({ ...liveSepehr, dataSource: "demo" }).kind).toBe("none");
  });

  it("keeps Amadeus unlinked instead of pretending there is a page", () => {
    const link = sourceRedirectFor({
      ...liveSepehr,
      providerId: "amadeus",
      offerUrl: "https://test.api.amadeus.com/v2/shopping/flight-offers/1",
    });
    expect(link.kind).toBe("none");
  });

  it("leaves an unknown provider on its own verified URL (no redirect route to claim)", () => {
    const link = sourceRedirectFor({
      ...liveSepehr,
      providerId: "other-source",
      offerUrl: "https://other-source.ir/search",
    });
    expect(link).toEqual({ kind: "external", url: "https://other-source.ir/search", blank: true });
  });

  it("still refuses a placeholder host for that unknown provider", () => {
    const link = sourceRedirectFor({
      ...liveSepehr,
      providerId: "other-source",
      offerUrl: "https://example.ir/search",
    });
    expect(link.kind).toBe("none");
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
