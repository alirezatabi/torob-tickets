import { describe, expect, it } from "vitest";

import { parseSelectionParam, selectionParam, splitSelectionToken } from "@/lib/selection-param";

/**
 * The compare link carries two things that both contain `:` — a group key
 * (`IR|IR3301|2026-11-20|IFN>KIH`) and an offer id (`flightio:ifn-kih-ir-3301:2026-11-20`).
 * Getting this split wrong is invisible in a unit test that only checks "some ids came back":
 * the page quietly renders «گزینه‌ای انتخاب نشده» instead of a table. These cases pin it.
 */

const GROUP = "IR|IR3301|2026-11-20|IFN>KIH";
const OFFER = "flightio:ifn-kih-ir-3301:2026-11-20";

describe("compare selection in the URL", () => {
  it("splits a token whose offer id contains colons", () => {
    expect(splitSelectionToken(`${GROUP}:${OFFER}`)).toEqual({ groupKey: GROUP, offerId: OFFER });
  });

  it("round-trips several selections", () => {
    const items = [
      { groupKey: GROUP, offerId: OFFER },
      { groupKey: "Y9|Y97204|2026-11-20|IFN>KIH", offerId: "pars:ifn-kih-y9-7204-2026-11-20" },
    ];
    expect(parseSelectionParam(selectionParam(items))).toEqual(items);
  });

  it("accepts a bare group key (old and bookmarked links)", () => {
    expect(splitSelectionToken(GROUP)).toEqual({ groupKey: GROUP, offerId: "" });
  });

  it("accepts a bare offer id and never invents a group key", () => {
    expect(splitSelectionToken(OFFER)).toEqual({ groupKey: OFFER, offerId: "" });
  });

  it("does not split on colons that are not followed by a valid group key", () => {
    const token = "not-a-group:key:value";
    expect(splitSelectionToken(token).offerId).toBe("");
  });

  it("ignores empty entries", () => {
    expect(parseSelectionParam("")).toEqual([]);
    expect(parseSelectionParam(`${GROUP}:${OFFER},`)).toHaveLength(1);
  });
});
