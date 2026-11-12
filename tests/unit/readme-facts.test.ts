import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { availableRoutes, routeCount, servedCities } from "@/lib/schedules";
import { airlineCount } from "@/lib/airlines";
import { CITIES } from "@/lib/cities";
import { toPersianDigits } from "@/lib/format";

/**
 * B17: the README's numbers are claims about the code, so they are *tested* against the code.
 *
 * A README that says "117 routes" while the timetable has 137 is not a typo, it is a false
 * statement in the product's own documentation. This test reads the README and the timetable
 * and refuses to let them drift.
 */
const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");

function fa(n: number): string {
  return toPersianDigits(n);
}

describe("README matches the code", () => {
  it("states the real number of routes", () => {
    expect(readme).toContain(`${fa(routeCount())} مسیر`);
  });

  it("states the real number of cities and airlines", () => {
    expect(readme).toContain(`${fa(servedCities().length)} شهر`);
    expect(readme).toContain(`${fa(airlineCount())} ایرلاین`);
  });

  it("does not claim the unavailable round-trip search", () => {
    expect(readme).not.toContain("رفت‌وبرگشت با دو جست‌وجو");
  });

  it("does not repeat the old 'unnumbered flights merge within 30 minutes' claim", () => {
    // The grouping law is carrier + number, or (unnumbered only) ±5 minutes — see dedupe tests.
    expect(readme).not.toMatch(/کمتر از ۳۰ دقیقه/);
  });

  it("counts the demo's non-Tehran domestic routes", () => {
    const nonTehran = availableRoutes().filter((r) => r.originCode !== "THR" && r.destinationCode !== "THR");
    expect(nonTehran.length).toBeGreaterThanOrEqual(20);
    expect(readme).toContain("غیرتهرانی");
    void CITIES;
  });
});
