import { describe, expect, it } from "vitest";

import globeDots from "@/lib/map/globe-dots.json";

const dots = globeDots as [number, number][];

function nearestLandDotDistance([lon, lat]: [number, number]): number {
  const latitudeScale = Math.cos((lat * Math.PI) / 180);
  return Math.min(
    ...dots.map(([dotLon, dotLat]) => {
      const wrappedLongitude = Math.abs(((dotLon - lon + 540) % 360) - 180);
      return Math.hypot(wrappedLongitude * latitudeScale, dotLat - lat);
    }),
  );
}

describe("homepage globe land dots", () => {
  it("keeps the Siberian land belt continuous across the Russia polygon's dateline wrap", () => {
    // These interior points used to have multi-degree gaps because each half of the dateline
    // split ring was scan-converted independently, losing the pair spanning most of Siberia.
    for (const point of [
      [100, 63.75],
      [120, 63.75],
      [150, 63.75],
      [170, 65.25],
    ] as [number, number][]) {
      expect(nearestLandDotDistance(point), `missing land near ${point.join(", ")}`).toBeLessThan(1.1);
    }
  });
});
