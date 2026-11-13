import { readFile, writeFile } from "node:fs/promises";

// Emit a deterministic 1.5° sampling of Natural Earth country polygons. The sample is used by the
// homepage's stylized dotted globe; route maps continue to use the full vector coastlines.
const source = JSON.parse(await readFile(new URL("../src/lib/map/countries-50m.json", import.meta.url), "utf8"));
const step = 1.5;
const rings = [];

function unwrapAtAntimeridian(ring) {
  const unwrapped = [];
  let previousLon = ring[0]?.[0] ?? 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [rawLon, lat] = ring[index];
    let lon = rawLon;
    if (index > 0) {
      while (lon - previousLon > 180) lon -= 360;
      while (lon - previousLon < -180) lon += 360;
    }
    unwrapped.push([lon, lat]);
    previousLon = lon;
  }
  return unwrapped;
}

for (const country of source.countries) {
  for (const raw of country.rings) {
    // Keep each polygon whole in an unwrapped longitude domain. Splitting a dateline-crossing
    // country into separate rings loses scanline pairs (notably across Siberia) and leaves huge
    // holes in the hero's land lights.
    const ring = unwrapAtAntimeridian(raw);
    const ys = ring.map(([_, lat]) => lat);
    rings.push({ minLat: Math.min(...ys), maxLat: Math.max(...ys), ring });
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
      for (const shift of [-360, 0, 360]) {
        const west = Math.max(-180, crossings[i] + shift);
        const east = Math.min(180, crossings[i + 1] + shift);
        if (west > east) continue;
        const lo = Math.ceil((west + 180 - offset) / lonStep);
        const hi = Math.floor((east + 180 - offset) / lonStep);
        for (let k = lo; k <= hi; k += 1) {
          let lon = -180 + offset + k * lonStep;
          if (lon >= 180) lon -= 360;
          points.add(`${lon.toFixed(3)},${lat.toFixed(3)}`);
        }
      }
    }
  }
}

const sorted = [...points].map((p) => p.split(",").map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
await writeFile(new URL("../src/lib/map/globe-dots.json", import.meta.url), `${JSON.stringify(sorted)}\n`);
console.log(`Wrote ${sorted.length.toLocaleString()} land dots.`);
