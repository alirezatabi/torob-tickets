import { describe, expect, it } from "vitest";

import { distanceKm, type Point } from "@/lib/geo";
import {
  COAST,
  coastLevel,
  decodeRing,
  loadCoast,
  vertexCount,
} from "@/lib/land";
import {
  arcLift,
  flightArc,
  lightAt,
  planeAt,
  projectRing,
  rotate,
  rotationMatrix,
  toVec,
} from "@/lib/globe3d";

/**
 * The globe is now real 3D, so the geometry is testable instead of merely "looks fine":
 * orientation, culling, depth order, the great circle and its lifted arc.
 */

const TEHRAN: Point = [51.39, 35.69];
const MASHHAD: Point = [59.64, 36.24];
const LONDON: Point = [-0.45, 51.47];

const cameraAt = (yaw: number, pitch: number, radius = 152) => ({
  m: rotationMatrix({ yaw, pitch }),
  radius,
  cx: 170,
  cy: 170,
});

describe("3D orientation", () => {
  it("puts the requested longitude/latitude at the centre of the disc", () => {
    for (const [lon, lat] of [TEHRAN, LONDON, [100, -20] as Point]) {
      const v = rotate(
        rotationMatrix({ yaw: lon, pitch: lat }),
        toVec(lon, lat),
      );
      // The camera looks down +y, so the centre of the disc is (0, 1, 0).
      expect(v.x).toBeCloseTo(0, 6);
      expect(v.y).toBeCloseTo(1, 6);
      expect(v.z).toBeCloseTo(0, 6);
    }
  });

  it("keeps rotation an isometry (lengths and angles are preserved)", () => {
    const m = rotationMatrix({ yaw: 37, pitch: -21, roll: 3 });
    const a = toVec(10, 20);
    const b = toVec(-140, -55);
    const ra = rotate(m, a);
    const rb = rotate(m, b);
    const dot = a.x * b.x + a.y * b.y + a.z * b.z;
    const rotatedDot = ra.x * rb.x + ra.y * rb.y + ra.z * rb.z;
    expect(rotatedDot).toBeCloseTo(dot, 12);
    expect(Math.hypot(ra.x, ra.y, ra.z)).toBeCloseTo(1, 12);
  });

  it("has the far side facing away from the camera", () => {
    const m = rotationMatrix({ yaw: TEHRAN[0], pitch: TEHRAN[1] });
    const antipode = rotate(m, toVec(TEHRAN[0] - 180, -TEHRAN[1]));
    expect(antipode.y).toBeLessThan(0);
  });
});

describe("coastline projection", () => {
  const ring = COAST[1][0]!;

  it("projects a visible ring into finite coordinates", () => {
    const projected = projectRing(ring, cameraAt(51, 30));
    expect(projected).not.toBeNull();
    expect(projected!.path).toMatch(/^M-?[\d.]+ -?[\d.]+/);
    expect(projected!.path).not.toContain("NaN");
    expect(projected!.depth).toBeGreaterThan(0);
    expect(projected!.depth).toBeLessThanOrEqual(1);
  });

  it("drops a ring that is entirely on the far side", () => {
    // The antipode of the view centre: no vertex can be on the near hemisphere.
    const projected = projectRing(ring, cameraAt(51 - 180, -30));
    expect(projected).toBeNull();
  });

  it("keeps every drawn coordinate inside the disc", () => {
    const camera = cameraAt(51, 30);
    const projected = projectRing(ring, camera)!;
    for (const [, x, y] of projected.path.matchAll(
      /[ML](-?[\d.]+) (-?[\d.]+)/g,
    )) {
      const dx = Number(x) - camera.cx;
      const dy = Number(y) - camera.cy;
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(camera.radius + 0.2);
    }
  });

  it("splits coastlines at the horizon instead of drawing a chord across the disc", () => {
    // Rings that straddle the limb must come back as more than one subpath; that is precisely the
    // difference between an orthographic globe and a flat map with a circular crop.
    const straddling = COAST[1].filter((ring) => {
      const projected = projectRing(ring, cameraAt(20, 10));
      if (!projected) return false;
      return (
        projected.visibleFraction > 0.02 && projected.visibleFraction < 0.98
      );
    });
    expect(straddling.length).toBeGreaterThan(0);
    const split = straddling.filter(
      (ring) =>
        (projectRing(ring, cameraAt(20, 10))?.path.match(/M/g) ?? []).length >
        1,
    );
    expect(split.length).toBeGreaterThan(0);
    // And no path may contain a segment longer than the disc: that is the chord bug.
    for (const ring of COAST[1]) {
      const projected = projectRing(ring, cameraAt(20, 10));
      if (!projected) continue;
      const points = [...projected.path.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(
        (match) => [Number(match[1]), Number(match[2])],
      );
      for (let index = 1; index < points.length; index += 1) {
        const [x1, y1] = points[index - 1]!;
        const [x2, y2] = points[index]!;
        expect(Math.hypot(x2! - x1!, y2! - y1!)).toBeLessThanOrEqual(
          2 * 152 + 0.2,
        );
      }
    }
  });
});

describe("coastline data", () => {
  it("round-trips the packed encoding", () => {
    const decoded = decodeRing({ n: 3, p: "AAABAAA" }, 50);
    expect(Array.from(decoded).every((value) => Number.isFinite(value))).toBe(
      true,
    );
    expect(decoded.length).toBe(6);
  });

  it("maps zoom to detail", () => {
    expect(vertexCount(1)).toBeGreaterThan(5_000);
    expect(coastLevel(1)).toBe(1);
    expect(coastLevel(2)).toBe(2);
    expect(coastLevel(5)).toBe(3);
  });

  it("ships only tier 1 eagerly, then loads the finer tiers on demand and reuses them", async () => {
    // The hero and the server's first frame must not pay for detail they cannot show.
    expect(vertexCount(1)).toBeGreaterThan(5_000);
    expect(COAST[2]).toHaveLength(0);
    expect(COAST[3]).toHaveLength(0);

    const second = await loadCoast(2);
    const third = await loadCoast(3);
    expect(second.length).toBeGreaterThan(200);
    expect(third.length).toBeGreaterThan(200);
    expect(vertexCount(3)).toBeGreaterThan(vertexCount(2));
    expect(vertexCount(2)).toBeGreaterThan(vertexCount(1));

    // Asking twice reuses the decoded rings — no second decode, no second import.
    await expect(loadCoast(2)).resolves.toBe(second);
    await expect(loadCoast(3)).resolves.toBe(third);
  });

  it("carries no ring across the antimeridian", async () => {
    // A ring that jumps 180° encloses half the planet once rotated — the bug that made the Pacific
    // read as land. The generator splits such rings; this keeps it honest.
    const tiers = [COAST[1], await loadCoast(2), await loadCoast(3)];
    expect(tiers.every((rings) => rings.length > 200)).toBe(true);
    for (const rings of tiers) {
      for (const ring of rings) {
        for (let index = 1; index < ring.length / 2; index += 1) {
          expect(
            Math.abs(ring[index * 2]! - ring[(index - 1) * 2]!),
          ).toBeLessThan(180);
        }
      }
    }
  });
});

describe("the flight arc", () => {
  const km = distanceKm(TEHRAN, MASHHAD);
  const angle = (km / 6371) * (180 / Math.PI);

  it("lifts longer routes higher, and keeps the lift small", () => {
    expect(arcLift(6)).toBeLessThan(arcLift(60));
    expect(arcLift(170)).toBeLessThanOrEqual(0.07);
  });

  it("starts at the origin and ends at the destination", () => {
    const camera = cameraAt(55.5, 36);
    const arc = flightArc(TEHRAN, MASHHAD, angle, camera);
    const first = arc.points[0]!;
    const last = arc.points[arc.points.length - 1]!;
    expect(first.t).toBe(0);
    expect(last.t).toBe(1);
    // The endpoint of the arc is the airport lifted radially by the arc height.
    const origin = rotate(camera.m, toVec(...TEHRAN));
    expect(first.v.y / origin.y).toBeCloseTo(1 + arc.lift, 6);
    expect(arc.originVisible).toBe(true);
    expect(arc.destinationVisible).toBe(true);
  });

  it("draws the ground track and the lifted arc as separate paths", () => {
    const camera = cameraAt(55.5, 36);
    const arc = flightArc(TEHRAN, MASHHAD, angle, camera);
    expect(arc.path).toMatch(/^M/);
    expect(arc.groundPath).toMatch(/^M/);
    // The lifted arc sits further from the centre than the ground track at the midpoint.
    const mid = arc.points[Math.floor(arc.points.length / 2)]!;
    const groundRadius = Math.hypot(mid.ground.x, mid.ground.z);
    const liftedRadius = Math.hypot(mid.v.x, mid.v.z);
    expect(liftedRadius).toBeGreaterThan(groundRadius);
  });

  it("never returns a plane position behind the sphere", () => {
    const camera = cameraAt(55.5, 36);
    const arc = flightArc(TEHRAN, MASHHAD, angle, camera);
    const behind = cameraAt(55.5 + 180, 36);
    const hidden = flightArc(TEHRAN, MASHHAD, angle, behind);
    expect(planeAt(arc, 0.5, camera)).not.toBeNull();
    expect(planeAt(hidden, 0.5, behind)).toBeNull();
  });
});

describe("lighting", () => {
  it("brightens the side facing the light and never goes black", () => {
    const near = lightAt({ x: -0.4, y: 0.7, z: 0.4 });
    const far = lightAt({ x: 0.4, y: -0.7, z: -0.4 });
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThanOrEqual(0.18);
    expect(near).toBeLessThanOrEqual(1);
  });
});
