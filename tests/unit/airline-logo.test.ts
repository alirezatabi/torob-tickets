import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { airlineBrand, EMBLEM_PATHS } from "@/lib/airlines/brand";
import { AIRLINES } from "@/lib/airlines";
import { AIRLINE_LOGO_ASSETS, airlineLogoPath } from "@/lib/airlines/logos";

const LOGO_DIR = path.join(process.cwd(), "src", "lib", "airlines", "logos");
const readme = readFileSync(path.join(process.cwd(), "README.md"), "utf8");

/**
 * The carrier mark that leads every flight row.
 *
 * These pin what the user asked for: each airline shows **its own** logo (a bundled file, not
 * a drawn emblem), the file really is in the repo (so nothing is fetched at runtime), and an
 * unknown carrier still gets a stable badge instead of an empty box.
 */
describe("airline logos", () => {
  it("bundles a real logo file for every carrier in the demo", () => {
    for (const airline of AIRLINES) {
      const src = airlineLogoPath(airline.code);
      expect(src, `${airline.code} has no logo asset`).toBeTruthy();
      const file = path.join(LOGO_DIR, path.basename(src!));
      expect(existsSync(file), `${airline.code}: ${file} is missing`).toBe(true);
      expect(readFileSync(file).byteLength).toBeGreaterThan(200);
    }
  });

  it("serves each logo from its own code, in the declared format", () => {
    for (const [code, asset] of Object.entries(AIRLINE_LOGO_ASSETS)) {
      expect(airlineLogoPath(code)).toBe(`/airline-logos/${code}.${asset.format}`);
    }
    expect(airlineLogoPath("ir")).toBe("/airline-logos/IR.svg");
  });

  it("ships vectors where it can, and says which carriers are raster", () => {
    const raster = Object.entries(AIRLINE_LOGO_ASSETS)
      .filter(([, asset]) => asset.format === "png")
      .map(([code]) => code)
      .sort();
    // These have no permissively licensed vector mark; a PNG of the real logo is still the
    // airline's logo, so it is bundled rather than substituted with a drawing.
    expect(raster).toEqual(["HY", "IA", "XQ", "ZV"]);
  });

  it("ships self-contained SVGs — no scripts, no remote references", () => {
    for (const [code, asset] of Object.entries(AIRLINE_LOGO_ASSETS)) {
      if (asset.format !== "svg") continue;
      const svg = readFileSync(path.join(LOGO_DIR, `${code}.svg`), "utf8");
      expect(svg, `${code} must be an svg`).toContain("<svg");
      expect(svg, `${code} must have a viewBox`).toContain("viewBox=");
      expect(svg).not.toContain("<script");
      expect(svg).not.toMatch(/(?:href|src)="(?:https?:)?\/\//);
      expect(svg).not.toContain("@import");
    }
  });

  it("leaves the drawn badge as the fallback for a carrier it has never seen", () => {
    expect(airlineLogoPath("ZZ")).toBeNull();
    const first = airlineBrand("ZZ");
    expect(first).toEqual(airlineBrand("zz"));
    expect(EMBLEM_PATHS[first.emblem]).toBeTruthy();
  });

  it("claims in the README only what is actually bundled", () => {
    // The README says every carrier has its real logo, so the count must match the bundle.
    expect(AIRLINES.length).toBe(23);
    expect(readme).toContain("۲۳ ایرلاین");
    expect(readme).toContain("لوگوی اصلی هر شرکت");
    expect(Object.keys(AIRLINE_LOGO_ASSETS).length).toBe(AIRLINES.length);
  });
});
