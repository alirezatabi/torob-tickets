/**
 * Spherical geometry + orthographic projection, small and dependency-free.
 *
 * The ticket page draws “the globe with this flight's route on it”, and that has to be an
 * honest drawing: the arc is the **great-circle** path between the two airports (the shortest
 * line over the Earth, which is what an aircraft approximately flies), the circle is a real
 * orthographic projection, and a point is only drawn when it is on the hemisphere facing the
 * viewer. No map tiles, no network, no library at runtime.
 *
 * All angles are degrees in the interface (lon/lat, like GeoJSON), radians inside.
 */

export interface LonLat {
  lon: number;
  lat: number;
  /** [longitude, latitude] tuple — the shape the map data uses. */
}

export type Point = [number, number];

export const EARTH_RADIUS_KM = 6371;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function sin(deg: number): number {
  return Math.sin(deg * RAD);
}
function cos(deg: number): number {
  return Math.cos(deg * RAD);
}
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Great-circle distance in kilometres (haversine). */
export function distanceKm(a: Point, b: Point): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const h =
    sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(clamp(Math.sqrt(h), 0, 1));
}

/**
 * Point at fraction `t` (0..1) along the great circle from `a` to `b`.
 *
 * Spherical linear interpolation, so the path is the true great circle and not a curve in
 * lon/lat space (a naive lerp visibly sags away from the real track on long routes).
 */
export function interpolate(a: Point, b: Point, t: number): Point {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const d = angularDistance(a, b);
  if (d < 1e-9) return [lon1, lat1];
  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);
  const x = A * cos(lat1) * cos(lon1) + B * cos(lat2) * cos(lon2);
  const y = A * cos(lat1) * sin(lon1) + B * cos(lat2) * sin(lon2);
  const z = A * sin(lat1) + B * sin(lat2);
  const lat = Math.atan2(z, Math.hypot(x, y)) * DEG;
  const lon = Math.atan2(y, x) * DEG;
  return [lon, lat];
}

/** Central angle between two points, in radians. */
export function angularDistance(a: Point, b: Point): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const cosine = sin(lat1) * sin(lat2) + cos(lat1) * cos(lat2) * cos(lon2 - lon1);
  return Math.acos(clamp(cosine, -1, 1));
}

/** Initial bearing from `a` to `b`, degrees clockwise from north. */
export function bearing(a: Point, b: Point): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const y = sin(lon2 - lon1) * cos(lat2);
  const x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(lon2 - lon1);
  return ((Math.atan2(y, x) * DEG) + 360) % 360;
}

function normalizeLon(lon: number): number {
  let value = ((lon + 180) % 360 + 360) % 360 - 180;
  if (value === -180) value = 180;
  return value;
}

export interface Projection {
  /** [lon,lat] → [x,y] in SVG units, or null when the point is behind the horizon. */
  project(point: Point): Point | null;
  /** True when the point is on the visible hemisphere (cosine of the angle > 0). */
  visible(point: Point): boolean;
  /** Angular distance (degrees) from the centre of the disc. */
  distanceFromCentre(point: Point): number;
  centre: Point;
  radius: number;
  cx: number;
  cy: number;
}

/**
 * Orthographic (“the globe as photographed from space”) projection centred on `centre`.
 * Everything is clipped by the caller to the circle of `radius` around (cx, cy).
 */
export function orthographic(centre: Point, radius: number, cx = radius, cy = radius): Projection {
  const [lon0, lat0] = centre;
  const cosLat0 = cos(lat0);

  function cosc(point: Point): number {
    const [lon, lat] = point;
    return sin(lat0) * sin(lat) + cosLat0 * cos(lat) * cos(lon - lon0);
  }

  return {
    centre,
    radius,
    cx,
    cy,
    visible(point) {
      return cosc(point) >= -1e-9;
    },
    distanceFromCentre(point) {
      return Math.acos(clamp(cosc(point), -1, 1)) * DEG;
    },
    project(point) {
      const c = cosc(point);
      // A hair behind the horizon still projects to the rim; drawing it would smear the
      // coastline across the disc, so anything not clearly facing us returns null.
      if (c < -1e-6) return null;
      const [lon, lat] = point;
      const x = cos(lat) * sin(lon - lon0);
      const y = cosLat0 * sin(lat) - sin(lat0) * cos(lat) * cos(lon - lon0);
      return [round(cx + radius * x), round(cy - radius * y)];
    },
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Centre of the smallest view that shows two points: the midpoint of the great circle. */
export function routeCentre(a: Point, b: Point): Point {
  const middle = interpolate(a, b, 0.5);
  return [normalizeLon(middle[0]), middle[1]];
}

/**
 * Split a polygon ring into the runs that are actually on the visible hemisphere.
 *
 * Naïvely projecting every vertex and skipping the hidden ones draws straight chords across
 * the disc where a continent curve wraps around the horizon — the classic orthographic
 * artefact. Breaking the ring into visible *runs* avoids it: each run is one clipped polygon
 * and the hidden stretch is simply not drawn (as on a real photo of the Earth).
 */
export function visibleRuns(ring: Point[], projection: Projection): Point[][] {
  const runs: Point[][] = [];
  let current: Point[] = [];

  for (const vertex of ring) {
    const projected = projection.project(vertex);
    if (projected) {
      current.push(projected);
    } else if (current.length > 0) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    if (runs.length === 0) runs.push(current);
    // A ring that starts and ends on the visible hemisphere is one continuous run.
    else if (projection.visible(ring[0]!)) runs[0] = [...current, ...runs[0]!];
    else runs.push(current);
  }

  return runs.filter((run) => run.length >= 3);
}

/** SVG path for one run of projected points. */
export function runToPath(run: Point[]): string {
  if (run.length === 0) return "";
  return `M${run.map(([x, y]) => `${x} ${y}`).join("L")}Z`;
}

/**
 * SVG path for a great-circle arc, with the hidden part of the curve cut out.
 *
 * Sampled in *angle* (not in longitude), so the polyline hugs the real track; a segment that
 * crosses the horizon breaks the path instead of jumping across the disc.
 */
export function greatCirclePath(
  a: Point,
  b: Point,
  projection: Projection,
  samples = 180,
): { path: string; visibleSamples: { point: Point; t: number }[] } {
  const segments: string[] = [];
  const visibleSamples: { point: Point; t: number }[] = [];
  let current: string[] = [];
  let started = false;

  // Extend a little past both ends when the endpoints sit close to the horizon, so the line
  // leaves the disc instead of stopping in mid-ocean.
  const steps = Math.max(24, samples);
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const geo = interpolate(a, b, t);
    const projected = projection.project(geo);
    if (!projected) {
      if (current.length > 1) segments.push(`M${current.join("L")}`);
      current = [];
      started = false;
      continue;
    }
    visibleSamples.push({ point: projected, t });
    const [x, y] = projected;
    if (!started) {
      current = [`${x} ${y}`];
      started = true;
    } else {
      current.push(`${x} ${y}`);
    }
  }
  if (current.length > 1) segments.push(`M${current.join("L")}`);

  return { path: segments.join(" "), visibleSamples };
}
