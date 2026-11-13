#!/usr/bin/env node
/**
 * Rebuilds `src/lib/map/land-{1,2,3}.json` — the coastlines the 3D globe rotates in the browser.
 *
 * Three detail tiers, because a globe is read at three scales:
 *
 *   tier   tolerance   where it is used
 *   1      ~0.18°      the whole planet on screen (1° ≈ 2.6 px, so 0.18° is half a pixel)
 *   2      ~0.05°      a continent filling the disc
 *   3      ~0.02°      a short domestic hop, where the disc is magnified up to ~8×
 *
 * Shipping three plain JSON arrays would cost about 1.2 MB, so the rings are quantised to a
 * 0.02° grid and delta-encoded as printable ASCII (the same idea as Google's polyline encoding:
 * zig-zag varint in 5-bit chunks, mapped onto a 64-character alphabet that needs no escaping in
 * JSON). Most consecutive vertices differ by one or two grid steps, so a vertex costs ~2 bytes
 * instead of ~24 — the highest tier comes out around 80 KB, which gzips to ~35 KB.
 *
 *   node scripts/build-land.mjs
 *
 * Deterministic and dependency-free: same input, same output. Run it only when the source map
 * changes; the result is committed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(root, "src/lib/map/countries-50m.json");

/** Grid steps per degree: 50 → 0.02° ≈ 2.2 km at the equator, below one pixel at maximum zoom. */
const SCALE = 50;

const TIERS = [
  { name: "coast1", tolerance: 0.18, minArea: 1.2 },
  { name: "coast2", tolerance: 0.05, minArea: 0.2 },
  { name: "coast3", tolerance: 0.02, minArea: 0.02 },
];


/** One file per tier: only level 1 is imported eagerly by the browser. */
const OUTPUTS = [
  { tier: TIERS[0], file: "land-1.json" },
  { tier: TIERS[1], file: "land-2.json" },
  { tier: TIERS[2], file: "land-3.json" },
];

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

/** Shoelace area in square degrees. */
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
 * jumps from +179 to −179 between neighbouring vertices. Drawn as one polygon that jump becomes a
 * straight chord across the whole planet, and once a view is centred near the seam the chord
 * encloses half the disc as "land" — a very visible bug on a globe you can spin. Splitting the ring
 * where it crosses the seam (and inserting the crossing point) keeps every ring local.
 */
function splitAtAntimeridian(ring) {
  const pieces = [];
  let current = [];
  let previousLon = null;
  let previousLat = null;

  for (const [lon, lat] of ring) {
    if (previousLon !== null && Math.abs(lon - previousLon) > 180) {
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

// ————— the packed alphabet —————
// 64 printable characters, none of which needs escaping inside a JSON string, ordered so that
// neighbouring values map to neighbouring characters (the output is meant to be gzipped anyway).
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const CHUNK = 5;

function encodeValues(values) {
  let out = "";
  for (const raw of values) {
    // Zig-zag: small negatives stay small.
    let value = raw < 0 ? ~(raw << 1) : raw << 1;
    while (value >= 0x20) {
      out += ALPHABET[(0x20 | (value & 0x1f)) % 64];
      value >>>= CHUNK;
    }
    out += ALPHABET[value % 64];
  }
  return out;
}

/** One ring → `{ n, p }`: vertex count and the packed pair stream (lat then lon, both delta). */
function packRing(ring) {
  const values = [];
  let previousLat = 0;
  let previousLon = 0;
  for (const [lon, lat] of ring.slice(0, -1)) {
    // The closing duplicate vertex is implied: every ring is treated as closed.
    const qLat = Math.round(lat * SCALE);
    const qLon = Math.round(lon * SCALE);
    values.push(qLat - previousLat, qLon - previousLon);
    previousLat = qLat;
    previousLon = qLon;
  }
  return { n: ring.length - 1, p: encodeValues(values) };
}

const source = JSON.parse(readFileSync(SOURCE, "utf8"));

/** One pass over the source at a given tolerance. */
function buildTier(tolerance, minArea) {
  const rings = [];
  for (const country of source.countries) {
    // Country boundaries are *not* drawn: political borders on a route map are noise, and the
    // coastlines of neighbouring countries already meet. One ring per coast piece is enough.
    for (const ring of country.rings) {
      if (ring.length < 4 || area(ring) < minArea) continue;
      for (const piece of splitAtAntimeridian(ring)) {
        if (piece.length < 4 || area(piece) < minArea) continue;
        const simplified = simplify(piece, tolerance);
        if (simplified.length < 4) continue;
        rings.push(packRing(simplified));
      }
    }
  }
  return rings;
}

const describe = (label, rings) =>
  `${label}: ${rings.length} rings / ${rings.reduce((total, ring) => total + ring.n, 0)} vertices`;

let total = 0;
for (const [index, output] of OUTPUTS.entries()) {
  const rings = buildTier(output.tier.tolerance, output.tier.minArea);
  const json = JSON.stringify({
    source: "Natural Earth 1:50m (public domain)",
    scale: SCALE,
    level: index + 1,
    rings,
  });
  writeFileSync(path.join(root, "src/lib/map", output.file), `${json}\n`);
  total += json.length;
  console.log(`  ${describe(output.file, rings)} — ${Math.round(json.length / 1024)} KB`);
}
console.log(`land: three tiers, ${Math.round(total / 1024)} KB in total`);
