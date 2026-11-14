/**
 * The coastlines as the globe consumes them.
 *
 * `scripts/build-land.mjs` packs Natural Earth 1:50m into three files, one per detail tier:
 *
 *   land-1.json  ~8k vertices  — decoded at module load; the whole planet, the hero, and the
 *                                server's first frame of a ticket page;
 *   land-2.json  ~22k vertices — a dynamic `import()` for the zoomed-in client view;
 *   land-3.json  ~39k vertices — dynamic `import()` only past 4× zoom.
 *
 * Only tier 1 is in the shared client chunk; a visitor who never magnifies the disc never downloads
 * the 151 KB of extra detail. The no-JS figure reuses tier 1 with a screen-space simplification.
 *
 * Packing: vertices are snapped to a 0.02° grid and delta-encoded as printable ASCII (zig-zag
 * varint in 5-bit chunks). Most neighbouring vertices differ by one grid step, so a vertex costs
 * about two bytes instead of twenty-four; all three tiers together are 183 KB.
 */
import packed1 from "@/lib/map/land-1.json";

export type Ring = Float64Array; // [lon, lat, lon, lat, …]
export type CoastLevel = 1 | 2 | 3;

interface PackedRing {
  /** Vertex count. */
  n: number;
  /** Packed delta stream: lat then lon per vertex, both on the quantisation grid. */
  p: string;
}

interface LandFile {
  scale: number;
  level: CoastLevel;
  rings: PackedRing[];
}

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const CHUNK = 5;
const VALUES = new Int16Array(128).fill(-1);
for (let index = 0; index < ALPHABET.length; index += 1) {
  VALUES[ALPHABET.charCodeAt(index)] = index;
}

/** Unpack one ring into interleaved lon/lat pairs. */
export function decodeRing(packedRing: PackedRing, scale: number): Ring {
  const ring = new Float64Array(packedRing.n * 2);
  const stream = packedRing.p;
  let cursor = 0;
  let lat = 0;
  let lon = 0;

  for (let index = 0; index < packedRing.n; index += 1) {
    for (let axis = 0; axis < 2; axis += 1) {
      let value = 0;
      let shift = 0;
      for (;;) {
        const code = VALUES[stream.charCodeAt(cursor)]!;
        cursor += 1;
        value |= (code & 0x1f) << shift;
        if (code < 0x20) break;
        shift += CHUNK;
      }
      // Undo the zig-zag: the low bit is the sign.
      const delta = value & 1 ? ~(value >> 1) : value >> 1;
      if (axis === 0) lat += delta;
      else lon += delta;
    }
    ring[index * 2] = lon / scale;
    ring[index * 2 + 1] = lat / scale;
  }
  return ring;
}

/** Decode a generated file. */
export function decodeAll(
  rings: PackedRing[] | undefined,
  scale: number,
): Ring[] {
  return (rings ?? []).map((ring) => decodeRing(ring, scale));
}

/** Tier 1 is the only tier decoded at module load: it is what every first frame draws. */
export const COAST: Record<CoastLevel, Ring[]> = {
  1: decodeAll(
    (packed1 as unknown as LandFile).rings,
    (packed1 as unknown as LandFile).scale,
  ),
  2: [],
  3: [],
};

const pending: Partial<Record<CoastLevel, Promise<Ring[]>>> = {};

/**
 * Load a detail tier on demand.
 *
 * Both imports are static strings, so the bundler splits each JSON into its own chunk: the front
 * page loads 31 KB of coastline, and a ticket page that is zoomed in loads the 61 KB (or 90 KB)
 * tier only then — never the other way round.
 */
export function loadCoast(level: CoastLevel): Promise<Ring[]> {
  if (COAST[level].length > 0) return Promise.resolve(COAST[level]);
  if (!pending[level]) {
    pending[level] = (
      level === 2
        ? import("@/lib/map/land-2.json")
        : import("@/lib/map/land-3.json")
    ).then((module) => {
      const file = module.default as unknown as LandFile;
      const rings = decodeAll(file.rings, file.scale);
      COAST[level] = rings;
      return rings;
    });
  }
  return pending[level]!;
}

/**
 * Which tier to draw at a given magnification.
 *
 * The thresholds follow the data: tier 1 is ~half a pixel at whole-planet scale, tier 2 at 4×, tier
 * 3 at 12×. Below a threshold the finer tier only adds sub-pixel vertices; above it, the coarser tier
 * is exactly the "flat coastline" look this exists to avoid.
 */
export function coastLevel(zoom: number): CoastLevel {
  if (zoom >= 4) return 3;
  if (zoom >= 1.6) return 2;
  return 1;
}

/** Total vertices in a tier — used by tests. */
export function vertexCount(level: CoastLevel): number {
  return COAST[level].reduce((total, ring) => total + ring.length / 2, 0);
}
