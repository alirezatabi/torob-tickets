import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { createQuery } from "@/domain/trip";
import { describeDemoProviders, SEARCH_MODE } from "@/modules/catalog/demo-providers";
import { runLiveSearch, type LiveGroupView } from "@/server/live-search";

/**
 * The real-data layer was removed on purpose. This test is the guard rail: it fails if a
 * connector, a provider switch or an outbound link ever creeps back in without the rest of
 * the honesty work that went with it.
 */

const ROOT = process.cwd();
const NOW = new Date("2026-11-12T06:00:00.000Z");

function sourceFiles(dir = join(ROOT, "src"), found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (/\.(ts|tsx)$/.test(entry)) found.push(path);
  }
  return found;
}

describe("demo-only data layer", () => {
  it("has exactly one search mode, and it is demo", () => {
    expect(SEARCH_MODE).toBe("demo");
  });

  it("describes only in-process demo providers, none able to claim availability", () => {
    const providers = describeDemoProviders();
    expect(providers.length).toBeGreaterThan(0);
    for (const provider of providers) {
      expect(provider.sourceKind).toBe("demo");
      expect(provider.configured).toBe(true);
      expect(provider.canClaimAvailability).toBe(false);
      // The gaps are stated, not hidden.
      expect(provider.missingFactsFa.length).toBeGreaterThan(0);
    }
  });

  it("labels every offer of a search as demo data", async () => {
    const payload = await runLiveSearch(
      createQuery({ originCode: "IFN", destinationCode: "KIH", departDate: "2026-11-12" }),
      { persist: false, now: NOW },
    );

    expect(payload.mode).toBe("demo");
    expect(payload.warnings).toContain("demo-mode");
    expect(payload.offers.length).toBeGreaterThan(0);
    for (const offer of payload.offers) {
      expect(offer.dataSource).toBe("demo");
      expect(offer.freshness).toBe("demo");
    }
    for (const report of payload.reports) {
      expect(report.mode).toBe("demo");
      expect(report.fromCache).toBe(false);
    }
  });

  it("never leaves the app: no card carries an external URL", async () => {
    const payload = await runLiveSearch(
      createQuery({ originCode: "IFN", destinationCode: "KIH", departDate: "2026-11-12" }),
      { persist: false, now: NOW },
    );
    const groups = payload.offers.filter((offer): offer is LiveGroupView => "groupKey" in offer);
    expect(groups.length).toBeGreaterThan(0);
    for (const offer of payload.offers) {
      expect(offer.offerUrl.startsWith("/")).toBe(true);
    }
  });

  it("keeps no connector source in the tree", () => {
    const files = sourceFiles().map((path) => relative(ROOT, path));
    const forbidden = ["modules/providers/", "modules/live/source-link", "api/go/"];
    for (const file of files) {
      for (const needle of forbidden) expect(file, `${file} should not exist`).not.toContain(needle);
    }
  });

  it("mentions no provider switch or connector endpoint anywhere in src/", () => {
    const banned = [
      "TOROB_SEARCH_MODE",
      "AMADEUS_CLIENT",
      "SEPEHR360_",
      "sepehr360.ir",
      "api.amadeus.com",
    ];
    for (const file of sourceFiles()) {
      const text = readFileSync(file, "utf8");
      for (const needle of banned) {
        expect(text.includes(needle), `${relative(ROOT, file)} mentions ${needle}`).toBe(false);
      }
    }
  });
});
