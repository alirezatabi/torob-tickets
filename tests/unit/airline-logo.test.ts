import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AIRLINES, getAirline } from "@/lib/airlines";
import { GET as serveAirlineLogo } from "@/app/airline-logos/[file]/route";
import { AIRLINE_LOGO_ASSETS, airlineLogoPath } from "@/lib/airlines/logos";
import { LIVE_AIRLINES, resolveAirlineCode } from "@/modules/airlines/registry";

const LOGO_DIR = path.join(process.cwd(), "src", "lib", "airlines", "logos");
const readme = readFileSync(path.join(process.cwd(), "README.md"), "utf8");
const logoSources = readFileSync(path.join(process.cwd(), "docs", "airline-logo-sources-fa.md"), "utf8");

describe("authentic airline logos", () => {
  it("trims separate wordmarks where the source has a standalone symbol", () => {
    const dimensions = (code: string) => {
      const png = readFileSync(path.join(LOGO_DIR, `${code}.png`));
      expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
      return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    };
    expect(dimensions("CPN")).toEqual({ width: 184, height: 156 });
    expect(dimensions("A7")).toEqual({ width: 820, height: 640 });
    expect(dimensions("NSN")).toEqual({ width: 76, height: 82 });
    expect(dimensions("IRZ")).toEqual({ width: 27, height: 54 });
  });

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

  it("serves the newly bundled Iranian marks, including three-letter codes", async () => {
    for (const file of ["IJ.png", "MEH.png", "FP.png", "AXV.png", "A7.png", "NSN.png", "IRZ.png", "CPN.png", "NV.png", "I3.png", "DZD.png"]) {
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
    expect(raster).toEqual([
      "A7", "AXV", "CPN", "DZD", "FP", "HY", "I3", "IA", "IJ", "IRZ", "MEH", "NSN", "NV", "XQ", "ZV",
    ]);
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

  it("resolves the requested Iranian carriers without confusing IATA and ICAO aliases", () => {
    const requested = [
      ["FP", "FlyPersia"], ["AXV", "Ava Airlines"], ["ATS", "Atlas Air"], ["A7", "Asa Jet"],
      ["VR", "Varesh Airlines"], ["NSN", "Nasim Air"], ["IRZ", "Saha Airlines"],
      ["CPN", "Caspian Airlines"], ["IS", "Sepahan Airlines"], ["I3", "ATA Airlines"],
      ["NV", "Karun Airlines"], ["DZD", "Yazd Air"], ["TKN", "Fly Kish"],
    ];
    for (const [code, name] of requested) {
      expect(LIVE_AIRLINES.some((airline) => airline.code === code && airline.en === name), `${code} ${name}`).toBe(true);
    }

    expect(resolveAirlineCode({ nameFa: "ساها" })).toEqual({ code: "IRZ", nameFa: "ساها" });
    expect(resolveAirlineCode({ nameFa: "کارون" })).toEqual({ code: "NV", nameFa: "کارون" });
    expect(resolveAirlineCode({ logoUrl: "https://example.test/logos/IV.png" })).toEqual({ code: "IV", nameFa: "کاسپین" });
    expect(airlineLogoPath("IV")).toBe("/airline-logos/CPN.png");
    expect(airlineLogoPath("UZ")).toBe("/airline-logos/DZD.png");
    expect(airlineLogoPath("unknown", "هواپیمایی آوا")).toBe("/airline-logos/AXV.png");
    expect(airlineLogoPath("unknown", "فلای پرشیا")).toBe("/airline-logos/FP.png");
    expect(airlineLogoPath("unknown", "Qatar Airways")).toBeNull();
  });

  it("uses the neutral fallback when a requested carrier has no sufficiently verified asset", () => {
    expect(airlineLogoPath("ATS")).toBeNull();
    expect(airlineLogoPath("VR")).toBeNull();
    expect(airlineLogoPath("IS")).toBeNull();
    expect(airlineLogoPath("TKN")).toBeNull();
    expect(airlineLogoPath("ZZ")).toBeNull();
  });

  it("documents the catalog and new marks accurately", () => {
    expect(readme).toContain("۲۵ ایرلاین");
    expect(readme).toContain("معراج");
    expect(readme).toContain("مهر");
    expect(Object.keys(AIRLINE_LOGO_ASSETS).length).toBeGreaterThan(AIRLINES.length);
    expect(logoSources).toContain("# منابع و وضعیت مجوز لوگوهای ایرانی");
    expect(logoSources).toContain("Airhex");
  });
});
