import { readFile, writeFile } from "node:fs/promises";

// Emit a deterministic 1.5° sampling of Natural Earth country polygons. The sample is used by the
// homepage's stylized dotted globe; route maps continue to use the full vector coastlines.
const source = JSON.parse(await readFile(new URL("../src/lib/map/countries-50m.json", import.meta.url), "utf8"));
const step = 1.5;
const rings = [];

for (const country of source.countries) {
  for (const raw of country.rings) {
    let ring = raw;
    // Split rings at the antimeridian before scan conversion; otherwise a polygon crossing ±180°
    // incorrectly fills most of the world. The Natural Earth source has only a few such edges.
    const split = [];
    let current = [ring[0]];
    for (let i = 1; i < ring.length; i += 1) {
      const previous = ring[i - 1];
      const point = ring[i];
      if (Math.abs(point[0] - previous[0]) > 180) {
        const shifted = point[0] > previous[0] ? point[0] - 360 : point[0] + 360;
        const boundary = point[0] > previous[0] ? -180 : 180;
        const denominator = shifted - previous[0];
        if (Math.abs(denominator) < 1e-9) {
          if (current.length > 2) split.push(current);
          current = [point];
          continue;
        }
        const t = (boundary - previous[0]) / denominator;
        const lat = previous[1] + (point[1] - previous[1]) * t;
        if (current.length > 2) split.push([...current, [boundary, lat]]);
        current = [[-boundary, lat], point];
      } else current.push(point);
    }
    if (current.length > 2) split.push(current);
    for (ring of split) {
      const ys = ring.map(([_, lat]) => lat);
      rings.push({ minLat: Math.min(...ys), maxLat: Math.max(...ys), ring });
    }
  }
}

const points = new Set();
let row = 0;
for (let lat = -84 + step / 2; lat <= 84; lat += step, row += 1) {
  const lonStep = Math.min(step / Math.max(0.1, Math.cos((lat * Math.PI) / 180)), 24);
  const offset = ((row * 0.37) % 1) * lonStep;
  for (const { minLat, maxLat, ring } of rings) {
    if (lat < minLat || lat >= maxLat) continue;
    const crossings = [];
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      if ((y1 > lat) !== (y2 > lat)) crossings.push(x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1));
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const lo = Math.ceil((crossings[i] + 180 - offset) / lonStep);
      const hi = Math.floor((crossings[i + 1] + 180 - offset) / lonStep);
      for (let k = lo; k <= hi; k += 1) {
        const lon = -180 + offset + k * lonStep;
        points.add(`${lon.toFixed(3)},${lat.toFixed(3)}`);
      }
    }
  }
}

const sorted = [...points].map((p) => p.split(",").map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
await writeFile(new URL("../src/lib/map/globe-dots.json", import.meta.url), `${JSON.stringify(sorted)}\n`);
console.log(`Wrote ${sorted.length.toLocaleString()} land dots.`);
