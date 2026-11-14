import { describe, expect, it } from "vitest";

import {
  bearing,
  distanceKm,
  greatCirclePath,
  interpolate,
  orthographic,
  routeCentre,
  visibleRuns,
  type Point,
} from "@/lib/geo";

/**
 * The globe is drawn from these four functions, so they are pinned here: real distances,
 * real great-circle tracks, and an honest horizon (no geometry drawn through the back of the
 * planet).
 */

const THR: Point = [51.39, 35.69]; // تهران
const IST: Point = [28.75, 41.28]; // استانبول
const LHR: Point = [-0.45, 51.47]; // لندن
const IFN: Point = [51.86, 32.75]; // اصفهان
const KIH: Point = [53.98, 26.53]; // کیش

describe("spherical geometry", () => {
  it("measures the real distance between airports", () => {
    // Reference values from the haversine formula (published airport distances within ~1%).
    expect(distanceKm(THR, IST)).toBeGreaterThan(1950);
    expect(distanceKm(THR, IST)).toBeLessThan(2100);
    expect(distanceKm(IFN, KIH)).toBeGreaterThan(650);
    expect(distanceKm(IFN, KIH)).toBeLessThan(780);
    expect(distanceKm(THR, LHR)).toBeGreaterThan(4300);
    expect(distanceKm(THR, LHR)).toBeLessThan(4500);
  });

  it("gives the compass direction of travel", () => {
    // Tehran → Istanbul is north-west; Tehran → London is even more so.
    const toIstanbul = bearing(THR, IST);
    const toLondon = bearing(THR, LHR);
    expect(toIstanbul).toBeGreaterThan(280);
    expect(toIstanbul).toBeLessThan(310);
    expect(toLondon).toBeGreaterThan(295);
    expect(toLondon).toBeLessThan(325);
  });

  it("interpolates along the great circle, not a straight line in lon/lat", () => {
    const midpoint = interpolate(THR, LHR, 0.5);
    // A lon/lat average would put the midpoint at ~(25.5, 43.6); the great circle bulges north.
    expect(midpoint[1]).toBeGreaterThan(46);
    // And both halves are the same distance by construction.
    expect(distanceKm(THR, midpoint)).toBeCloseTo(distanceKm(midpoint, LHR), 0);
  });
});

describe("orthographic projection", () => {
  it("puts the centre of the view at the centre of the disc", () => {
    const projection = orthographic(routeCentre(THR, IST), 100, 100, 100);
    const centre = projection.project(projection.centre)!;
    expect(centre[0]).toBeCloseTo(100, 1);
    expect(centre[1]).toBeCloseTo(100, 1);
  });

  it("hides the far side of the planet instead of drawing through it", () => {
    const projection = orthographic([0, 0], 100, 100, 100);
    expect(projection.project([0, 0])).not.toBeNull();
    expect(projection.project([90, 0])).not.toBeNull();
    expect(projection.project([180, 0])).toBeNull();
    expect(projection.project([-120, -30])).toBeNull();
  });

  it("keeps the whole route on the visible hemisphere", () => {
    for (const [a, b] of [
      [THR, IST],
      [IFN, KIH],
      [THR, LHR],
    ] as const) {
      const projection = orthographic(routeCentre(a, b), 150, 150, 150);
      const arc = greatCirclePath(a, b, projection);
      expect(arc.visibleSamples.length).toBeGreaterThan(100);
      expect(arc.path.startsWith("M")).toBe(true);
      // Both endpoints project, and the arc stays inside the disc.
      expect(projection.project(a)).not.toBeNull();
      expect(projection.project(b)).not.toBeNull();
      for (const { point } of arc.visibleSamples) {
        expect(Math.hypot(point[0] - 150, point[1] - 150)).toBeLessThanOrEqual(151);
      }
    }
  });

  it("splits a coastline that wraps around the horizon into visible runs", () => {
    // A parallel at the equator, seen from above 0,0: the far half is invisible.
    const ring: Point[] = [];
    for (let lon = -180; lon <= 180; lon += 5) ring.push([lon, 0]);
    const projection = orthographic([0, 0], 100, 100, 100);
    const runs = visibleRuns(ring, projection);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      for (const [x, y] of run) {
        expect(Math.hypot(x - 100, y - 100)).toBeLessThanOrEqual(101);
      }
    }
  });
});
