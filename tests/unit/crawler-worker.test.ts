import { describe, expect, it } from "vitest";
import { loadWorkerConfig } from "@/crawler/worker";

describe("continuous crawler configuration", () => {
  it("requires explicit operator route selection instead of demo timetable routes", () => {
    expect(() => loadWorkerConfig({})).toThrow(/CRAWLER_ROUTES/);
  });

  it("accepts unique directional domestic airport pairs and bounded schedule settings", () => {
    const config = loadWorkerConfig({
      CRAWLER_ROUTES: "thr-mhd,THR-SYZ,THR-MHD",
      CRAWLER_INTERVAL_MINUTES: "120",
      CRAWLER_HORIZON_DAYS: "3",
    });
    expect(config.routes).toEqual([
      { originCode: "THR", destinationCode: "MHD" },
      { originCode: "THR", destinationCode: "SYZ" },
    ]);
    expect(config.intervalMs).toBe(2 * 60 * 60_000);
    expect(config.horizonDays).toBe(3);
  });

  it("rejects malformed routes, unsafe schedules, and batches over the HTTP ceiling", () => {
    expect(() => loadWorkerConfig({ CRAWLER_ROUTES: "THR-MHD;BAD" })).toThrow(/Invalid domestic airport pair/);
    expect(() => loadWorkerConfig({ CRAWLER_ROUTES: "THR-MHD", CRAWLER_INTERVAL_MINUTES: "1" })).toThrow(/between 60 and 1440/);
    expect(() => loadWorkerConfig({ CRAWLER_ROUTES: "THR-MHD", CRAWLER_HORIZON_DAYS: "15" })).toThrow(/between 1 and 14/);
    const routeCodes = Array.from({ length: 40 }, (_, value) => String.fromCharCode(65 + Math.floor(value / 676), 65 + Math.floor(value / 26) % 26, 65 + value % 26));
    expect(() => loadWorkerConfig({ CRAWLER_ROUTES: routeCodes.map((code) => `THR-${code}`).join(",") })).toThrow(/per-cycle HTTP request ceiling/);
  });
});
