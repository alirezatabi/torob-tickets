import { describe, expect, it } from "vitest";

import { getPriceHistory, HISTORY_RANGE_LABELS_FA } from "@/modules/history/price-history";

/**
 * History segmentation is asserted at the contract level: without a database the
 * service must return an honest "not available" answer, never an empty chart that
 * looks like "prices never changed".
 */
describe("price history without a database", () => {
  it("reports unavailability with an actionable Persian reason", async () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    const result = await getPriceHistory({ originCity: "THR", destinationCity: "MHD", range: "30d" });

    expect(result.available).toBe(false);
    expect(result.series).toEqual([]);
    expect(result.reasonFa).toContain("PostgreSQL");

    if (previous) process.env.DATABASE_URL = previous;
  });

  it("refuses an unbounded query even when a database exists", async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://example";
    process.env.TOROB_DB_MODE = "off";

    const result = await getPriceHistory({ range: "7d" });
    expect(result.available).toBe(false);
    expect(result.reasonFa).toContain("مسیر");

    process.env.TOROB_DB_MODE = "";
    if (previous) process.env.DATABASE_URL = previous;
    else delete process.env.DATABASE_URL;
  });

  it("labels every supported range in Persian", () => {
    expect(Object.values(HISTORY_RANGE_LABELS_FA)).toHaveLength(5);
    expect(HISTORY_RANGE_LABELS_FA["24h"]).toBe("۲۴ ساعت");
    expect(HISTORY_RANGE_LABELS_FA.all).toBe("کل بازه");
    for (const label of Object.values(HISTORY_RANGE_LABELS_FA)) {
      expect(label.length).toBeGreaterThan(2);
    }
  });
});
