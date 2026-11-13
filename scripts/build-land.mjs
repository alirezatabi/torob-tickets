#!/usr/bin/env node
/**
 * Rebuilds `src/lib/map/land-1deg.json` — the land rings the interactive globe rotates in the
 * browser, thinned so 291 rings fit in a few hundred kilobytes instead of a megabyte.
 *
 * Why a second copy of the coastlines: the ticket page's globe is now drawn **on the client** so it
 * can spin. Shipping the full 1:50m rings (~1.1 MB, 77k vertices) to every visitor to move a 300 px
 * disc is not defensible, so the client gets a thinned 1°-grade coastline (Visvalingam-style
 * point dropping plus Ramer–Douglas–Peucker), and the *server* keeps using the full file for the
 * static fallback.
 *
 *   node scripts/build-land.mjs [--tolerance 0.12]
 *
 * Deterministic and dependency-free: same input, same output. Run it only when the source map
 * changes; the result is committed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(root, "src/lib/map/countries-50m.json");
const TARGET = path.join(root, "src/lib/map/land-1deg.json");

const args = process.argv.slice(2);
const toleranceArg = args.indexOf("--tolerance");
const TOLERANCE = toleranceArg >= 0 ? Number(args[toleranceArg + 1]) : 0.12;

const round = (value) => Math.round(value * 10) / 10;

/** Ramer–Douglas–Peucker on lon/lat pairs (degrees). */
function simplify(points, tolerance) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let farthest = -1;
    let maxDistance = 0;
    const [x1, y1] = points[first];
    const [x2, y2] = points[last];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    for (let index = first + 1; index < last; index += 1) {
      const [px, py] = points[index];
      const distance =
        lengthSquared === 0
          ? Math.hypot(px - x1, py - y1)
          : (() => {
              const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
              return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
            })();
      if (distance > maxDistance) {
        maxDistance = distance;
        farthest = index;
      }
    }
    if (maxDistance > tolerance && farthest > 0) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
}

/** A ring is kept only if it encloses enough area to be visible at globe scale. */
function area(ring) {
  let sum = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/**
 * Cut a ring at the antimeridian.
 *
 * Natural Earth stores rings in [-180, 180], so a country that spans the date line (Russia, Fiji)
 * jumps from +179 to −179 between two neighbouring vertices. Drawn as one polygon that jump
 * becomes a straight chord across the whole planet, and once a view is centred near the seam the
 * chord encloses half the disc as "land" — a very visible bug on a globe you can spin. Splitting
 * the ring where it crosses the seam (and inserting the crossing point) keeps every ring local.
 */
function splitAtAntimeridian(ring) {
  const pieces = [];
  let current = [];
  let previousLon = null;
  let previousLat = null;

  for (const [lon, lat] of ring) {
    if (previousLon !== null && Math.abs(lon - previousLon) > 180) {
      // The ring crossed the seam: finish the current piece exactly at ±180 and resume on the
      // other side, so no polygon ever spans more than 180° of longitude.
      const target = lon > previousLon ? -180 : 180;
      const shifted = lon > previousLon ? lon - 360 : lon + 360;
      const t = (target - previousLon) / (shifted - previousLon);
      const crossingLat = previousLat + (lat - previousLat) * t;
      if (current.length >= 3) pieces.push([...current, [target, crossingLat]]);
      current = [[-target, crossingLat]];
    }
    current.push([lon, lat]);
    previousLon = lon;
    previousLat = lat;
  }
  if (current.length >= 3) pieces.push(current);
  return pieces.filter((piece) => piece.length >= 4);
}

const source = JSON.parse(readFileSync(SOURCE, "utf8"));
const rings = [];

for (const country of source.countries) {
  for (const ring of country.rings) {
    if (ring.length < 4 || area(ring) < 0.6) continue;
    for (const piece of splitAtAntimeridian(ring)) {
      if (piece.length < 4 || area(piece) < 0.6) continue;
      const simplified = simplify(piece, TOLERANCE);
      if (simplified.length < 4) continue;
      // Closed ring: the browser draws them as a single path per country, so keep them as pairs.
      rings.push(simplified.map(([lon, lat]) => [round(lon), round(lat)]));
    }
  }
}

const vertices = rings.reduce((total, ring) => total + ring.length, 0);
const output = { source: "Natural Earth 1:50m (public domain)", tolerance: TOLERANCE, rings };
const json = JSON.stringify(output);
writeFileSync(TARGET, `${json}\n`);

console.log(
  `land-1deg.json: ${rings.length} rings, ${vertices} vertices, ${Math.round(json.length / 1024)} KB`,
);
