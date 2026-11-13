import { describe, expect, it } from "vitest";

import { airlineBrand, EMBLEM_PATHS } from "@/lib/airlines/brand";

/**
 * The badge that leads every flight row: a carrier's livery colours plus a drawn emblem.
 * These tests pin the two properties that matter — it is *stable* (the same airline always
 * looks the same, so the eye can learn it) and it never renders an empty shape.
 */
describe("airline badges", () => {
  it("gives a named airline its own colours and a real emblem", () => {
    for (const code of ["IR", "TK", "QR", "PC", "Y9"]) {
      const brand = airlineBrand(code);
      expect(brand.from).toMatch(/^#[0-9a-f]{6}$/i);
      expect(brand.to).toMatch(/^#[0-9a-f]{6}$/i);
      expect(EMBLEM_PATHS[brand.emblem]).toBeTruthy();
    }
  });

  it("is case-insensitive and stable", () => {
    expect(airlineBrand("ir")).toEqual(airlineBrand("IR"));
    expect(airlineBrand("IR")).toEqual(airlineBrand("IR"));
  });

  it("invents a deterministic badge for an airline it has never seen", () => {
    const first = airlineBrand("ZZ");
    const second = airlineBrand("ZZ");
    expect(first).toEqual(second);
    expect(EMBLEM_PATHS[first.emblem]).toBeTruthy();
    // And a different unknown carrier gets its own (not necessarily different) identity.
    expect(EMBLEM_PATHS[airlineBrand("QQ").emblem]).toBeTruthy();
  });
});
