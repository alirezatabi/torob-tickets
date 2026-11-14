import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AIRLINES, getAirline } from "@/lib/airlines";
import { GET as serveAirlineLogo } from "@/app/airline-logos/[file]/route";
import { AIRLINE_LOGO_ASSETS, airlineLogoPath } from "@/lib/airlines/logos";

const LOGO_DIR = path.join(process.cwd(), "src", "lib", "airlines", "logos");
const readme = readFileSync(path.join(process.cwd(), "README.md"), "utf8");

describe("authentic airline logos", () => {
  it("bundles an authentic logo file for every catalogued airline", () => {
    for (const airline of AIRLINES) {
      const src = airlineLogoPath(airline.code);
      expect(src, `${airline.code} has no logo asset`).toBeTruthy();
      const file = path.join(LOGO_DIR, path.basename(src!));
      expect(existsSync(file), `${airline.code}: ${file} is missing`).toBe(true);
      expect(readFileSync(file).byteLength).toBeGreaterThan(200);
    }
  });

  it("uses official Meraj and Mehr marks for their code and name variants", () => {
    expect(airlineLogoPath("IJ")).toBe("/airline-logos/IJ.png");
    expect(airlineLogoPath("JI")).toBe("/airline-logos/IJ.png");
    expect(airlineLogoPath("MRJ")).toBe("/airline-logos/IJ.png");
    expect(airlineLogoPath("unknown", "معراج ایرلاین")).toBe("/airline-logos/IJ.png");
    expect(airlineLogoPath("MEH")).toBe("/airline-logos/MEH.png");
    expect(airlineLogoPath("unknown", "Mehr Airways")).toBe("/airline-logos/MEH.png");
    expect(getAirline("MRJ")?.en).toBe("Meraj Airlines");
  });

  it("serves each bundled logo from its declared code and format", () => {
    for (const [code, asset] of Object.entries(AIRLINE_LOGO_ASSETS)) {
      expect(airlineLogoPath(code)).toBe(`/airline-logos/${code}.${asset.format}`);
    }
    expect(airlineLogoPath("ir")).toBe("/airline-logos/IR.svg");
  });

  it("serves both newly added original marks, including Mehr's three-letter ICAO code", async () => {
    for (const file of ["IJ.png", "MEH.png"]) {
      const response = await serveAirlineLogo(new Request(`http://localhost/airline-logos/${file}`), {
        params: Promise.resolve({ file }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
    }
  });

  it("uses raster artwork only for the declared raster marks", () => {
    const raster = Object.entries(AIRLINE_LOGO_ASSETS)
      .filter(([, asset]) => asset.format === "png")
      .map(([code]) => code)
      .sort();
    expect(raster).toEqual(["HY", "IA", "IJ", "MEH", "XQ", "ZV"]);
  });

  it("ships self-contained SVGs with no scripts or remote references", () => {
    for (const [code, asset] of Object.entries(AIRLINE_LOGO_ASSETS)) {
      if (asset.format !== "svg") continue;
      const svg = readFileSync(path.join(LOGO_DIR, `${code}.svg`), "utf8");
      expect(svg).toContain("<svg");
      expect(svg).toContain("viewBox=");
      expect(svg).not.toContain("<script");
      expect(svg).not.toMatch(/(?:href|src)="(?:https?:)?\/\//);
      expect(svg).not.toContain("@import");
    }
  });

  it("does not invent or draw a logo for an unknown airline", () => {
    expect(airlineLogoPath("ZZ")).toBeNull();
  });

  it("documents the catalog and new marks accurately", () => {
    expect(readme).toContain("۲۵ ایرلاین");
    expect(readme).toContain("معراج");
    expect(readme).toContain("مهر");
    expect(Object.keys(AIRLINE_LOGO_ASSETS).length).toBe(AIRLINES.length);
  });
});
