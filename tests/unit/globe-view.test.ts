import { describe, expect, it } from "vitest";

import land from "@/lib/map/land-1deg.json";
import {
  initialView,
  normalizeLon,
  projectGraticule,
  projectLand,
  projectRoute,
  viewCentre,
} from "@/lib/globe-view";

const TEHRAN: [number, number] = [51.39, 35.69];
const MASHHAD: [number, number] = [59.64, 36.24];
const BANDAR: [number, number] = [56.38, 27.22];

const view = (yaw: number, pitch = 22) => ({ yaw, pitch, radius: 152, cx: 170, cy: 170 });

/** A tiny square "continent" around the origin, enough to exercise clipping. */
const SQUARE: [number, number][] = [
  [50, 34],
  [54, 34],
  [54, 38],
  [50, 38],
  [50, 34],
];

describe("the client coastline data", () => {
  const rings = (land as unknown as { rings: [number, number][][] }).rings;

  it("is small enough to ship to a phone", () => {
    const vertices = rings.reduce((total, ring) => total + ring.length, 0);
    expect(rings.length).toBeGreaterThan(200);
    expect(vertices).toBeLessThan(20_000);
    expect(JSON.stringify(land).length).toBeLessThan(200 * 1024);
  });

  it("never carries a ring across the antimeridian", () => {
    // A ring that jumps 180° encloses half the planet once projected — the bug that made the
    // Pacific read as land. The generator splits such rings; this test keeps it honest.
    const offenders = rings.filter((ring) =>
      ring.some((point, index) => index > 0 && Math.abs(point[0] - ring[index - 1]![0]) > 180),
    );
    expect(offenders).toHaveLength(0);
  });

  it("keeps every coordinate inside the lon/lat domain", () => {
    for (const ring of rings) {
      for (const [lon, lat] of ring) {
        expect(lon).toBeGreaterThanOrEqual(-180);
        expect(lon).toBeLessThanOrEqual(180);
        expect(lat).toBeGreaterThanOrEqual(-90);
        expect(lat).toBeLessThanOrEqual(90);
      }
    }
  });
});

describe("globe view", () => {
  it("wraps longitude into [-180, 180)", () => {
    expect(normalizeLon(0)).toBe(0);
    expect(normalizeLon(190)).toBeCloseTo(-170, 6);
    expect(normalizeLon(-190)).toBeCloseTo(170, 6);
    expect(normalizeLon(360)).toBe(0);
    expect(normalizeLon(540)).toBeCloseTo(-180, 6);
  });

  it("centres the view on the yaw (longitude) and the pitch (latitude)", () => {
    expect(viewCentre(view(51.39))[0]).toBeCloseTo(51.39, 6);
    expect(viewCentre(view(51.39))[1]).toBe(22);
    expect(viewCentre(view(0, 95))[1]).toBe(78);
    expect(viewCentre(view(0, -95))[1]).toBe(-78);
    expect(viewCentre(view(400))[0]).toBeCloseTo(40, 6);
  });

  it("draws land that faces the camera and drops land on the far side", () => {
    const near = projectLand([SQUARE], view(51));
    expect(near.length).toBeGreaterThan(0);

    // Half a world away: nothing of this continent can be visible.
    const far = projectLand([SQUARE], view(51 + 180));
    expect(far).toEqual([]);
  });

  it("keeps every projected land point inside the disc", () => {
    const options = view(51);
    for (const path of projectLand([SQUARE], options)) {
      for (const [, x, y] of path.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) {
        const dx = Number(x) - options.cx;
        const dy = Number(y) - options.cy;
        expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(options.radius + 0.01);
      }
    }
  });

  it("projects the route with both endpoints on the near side when they are centred", () => {
    const route = projectRoute(TEHRAN, MASHHAD, view(55));
    expect(route.origin).not.toBeNull();
    expect(route.destination).not.toBeNull();
    expect(route.points.length).toBe(97);
    expect(route.visibleFraction).toBe(1);
    expect(route.hidden.every((value) => value === false)).toBe(true);
  });

  it("keeps the sample count fixed and marks the hidden part when the route is on the far side", () => {
    const route = projectRoute(TEHRAN, MASHHAD, view(55 + 180));
    expect(route.points.length).toBe(97);
    expect(route.visibleFraction).toBe(0);
    expect(route.origin).toBeNull();
    expect(route.hidden.every(Boolean)).toBe(true);
  });

  it("moves the projection when the globe is turned", () => {
    const a = projectRoute(TEHRAN, BANDAR, view(45)).origin!;
    const b = projectRoute(TEHRAN, BANDAR, view(60)).origin!;
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(1);
  });

  it("zooms in for a short hop and stays whole-planet for a long haul", () => {
    const short = initialView(TEHRAN, MASHHAD, 740, 340, 152);
    expect(short.zoom).toBeGreaterThan(1);
    const long = initialView(TEHRAN, [2.55, 49.01], 4200, 340, 152);
    expect(short.zoom).toBeGreaterThan(long.zoom);
    expect(long.zoom).toBeGreaterThanOrEqual(1);
    expect(short.zoom).toBeLessThanOrEqual(4.5);
    // The centre is the midpoint of the route, not the origin — in both axes.
    expect(Math.abs(short.yaw - 55.5)).toBeLessThan(1.5);
    expect(Math.abs(short.pitch - 36)).toBeLessThan(1.5);
    expect(short.zoom).toBeLessThanOrEqual(4.5);
  });

  it("builds a graticule that stays on the visible disc", () => {
    const options = view(20);
    const paths = projectGraticule(options, 30);
    expect(paths.length).toBeGreaterThan(3);
    for (const path of paths) {
      for (const [, x, y] of path.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) {
        expect(Math.hypot(Number(x) - options.cx, Number(y) - options.cy)).toBeLessThanOrEqual(
          options.radius + 0.01,
        );
      }
    }
  });
});
