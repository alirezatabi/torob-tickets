import { describe, expect, it, vi } from "vitest";
import { createQuery } from "@/domain/trip";
import { FLIGHT_PROVIDERS, listProviders } from "@/providers/registry";
import { runSearch } from "@/providers/search";
import { GET } from "@/app/api/live/search/route";

describe("real-data-only site", () => {
  it("advertises only Safarmarket as a real source", () => {
    expect(listProviders().map((provider) => provider.id)).toEqual(["safarmarket"]);
    expect(listProviders().every((provider) => provider.mode === "crawled")).toBe(true);
  });

  it("forces production searches to real sources even if the URL requests demo/all", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const outcome = await runSearch(createQuery({
        originCode: "IFN", destinationCode: "KIH", departDate: "2026-11-20",
      }), { providers: FLIGHT_PROVIDERS, includeCrawled: true, now: new Date("2026-11-12T06:00:00.000Z") });
      expect(outcome.query.filters.dataSource).toBe("real");
      expect(outcome.offers.every((offer) => offer.dataSource !== "demo")).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("retires the old demo-backed live search endpoint instead of returning sample tickets", async () => {
    const response = await GET();
    expect(response.status).toBe(410);
    const body = await response.json();
    expect(body.messageFa).toContain("/api/search");
  });
});
