/**
 * A small, honest 3D globe — the maths.
 *
 * Nothing here touches React or the DOM, so the whole globe can be unit-tested: the rotation is a
 * real 3×3 matrix (yaw, pitch and a little roll), every vertex is carried into camera space, the
 * hemisphere facing away is culled by its sign on the view axis, and what is drawn is sorted by
 * depth so the near side of a mountain range, the near half of the route and the marker on top of
 * them stack correctly.
 *
 * Why not WebGL: a 300 px disc does not need a GPU, and this way the drawing stays inspectable
 * (an `<svg>` you can read), works without a canvas context, and can be rendered server-side for the
 * no-JavaScript figure. The cost that matters is per frame: the coastline is pre-rotated, so a frame
 * is one pass over the vertices of the *current* detail tier (~8k–39k) plus a per-ring fill decision.
 */

export type Point = [number, number]; // [lon, lat]
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const RAD = Math.PI / 180;

/** Geographic → unit sphere. lon 0 is at +y, lat 0 at +x… whichever, as long as it is consistent. */
export function toVec(lon: number, lat: number): Vec3 {
  const phi = lat * RAD;
  const lambda = lon * RAD;
  const cosPhi = Math.cos(phi);
  return { x: cosPhi * Math.cos(lambda), y: cosPhi * Math.sin(lambda), z: Math.sin(phi) };
}

export interface Orientation {
  /** Rotation about the polar axis, degrees. */
  yaw: number;
  /** Tilt towards/away from the viewer, degrees. */
  pitch: number;
  /** Screen-space roll, degrees — a few degrees makes the sphere feel like an object in orbit. */
  roll?: number;
}

/**
 * Rotation matrix, built once per frame.
 *
 * Three turns, composed:
 *   1. `Rz(90° − yaw)` — spin the planet so the requested longitude faces the viewer. The extra
 *      90° is the camera convention: +y is *towards the viewer*, +x right, +z up.
 *   2. `Rx(pitch)` — tilt the sphere so the requested latitude is at the centre of the disc.
 *   3. `Rz(roll)` — lean the whole disc on screen, a few degrees, so the sphere reads as an object
 *      in orbit rather than a diagram.
 *
 * With this composition `toVec(lon, lat)` mapped by the matrix is exactly `(0, 1, 0)` — the point
 * on the sphere nearest the camera — which is what the unit test asserts.
 */
export function rotationMatrix(orientation: Orientation): number[] {
  const spin = (90 - orientation.yaw) * RAD;
  const tilt = orientation.pitch * RAD;
  const lean = (orientation.roll ?? 0) * RAD;
  const cs = Math.cos(spin);
  const ss = Math.sin(spin);
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const cl = Math.cos(lean);
  const sl = Math.sin(lean);

  // Rz(spin): the point at `yaw` lands on +x.
  const rz = [cs, -ss, 0, ss, cs, 0, 0, 0, 1];
  // Rx(tilt): +x stays put, the near direction becomes +y.
  const rx = [1, 0, 0, 0, ct, st, 0, -st, ct];
  // Rz(lean) on screen: same shape as the spin matrix.
  const rr = [cl, -sl, 0, sl, cl, 0, 0, 0, 1];

  const mul = (m: number[], n: number[]): number[] => {
    const out = new Array<number>(9);
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        out[row * 3 + col] =
          m[row * 3]! * n[col]! + m[row * 3 + 1]! * n[3 + col]! + m[row * 3 + 2]! * n[6 + col]!;
      }
    }
    return out;
  };

  return mul(rr, mul(rx, rz));
}

/** Apply the matrix to a vector. */
export function rotate(m: number[], v: Vec3): Vec3 {
  return {
    x: m[0]! * v.x + m[1]! * v.y + m[2]! * v.z,
    y: m[3]! * v.x + m[4]! * v.y + m[5]! * v.z,
    z: m[6]! * v.x + m[7]! * v.y + m[8]! * v.z,
  };
}

export interface Camera {
  /** Matrix for the current orientation. */
  m: number[];
  /** Disc radius in view units. */
  radius: number;
  cx: number;
  cy: number;
  /** Radius of the sphere: 1 for the globe, >1 for an altitude-exaggerated arc. */
  sphere?: number;
}

export interface ProjectedRing {
  path: string;
  /** Mean cosine of the ring's vertices on the near side, 0..1 (for shading and depth sort). */
  depth: number;
  /** How much of the ring is on the near side, 0..1. */
  visibleFraction: number;
}

/** A ring is dozens of vertices; a fixed-point stream is much cheaper than array-of-objects. */
const coord = (value: number): number => Math.round(value * 10) / 10;

/**
 * Project one closed coastline ring.
 *
 * Vertices on the far side are dropped and the ring is split into runs, so a continent that wraps
 * around the limb is drawn as the near part only — the same result you get from photographing a
 * globe, instead of a chord cutting across the disc. A ring whose centroid is on the far side is
 * skipped entirely (it cannot contribute a visible face).
 */
export function projectRing(ring: Float64Array, camera: Camera): ProjectedRing | null {
  const count = ring.length / 2;
  if (count < 3) return null;

  let depthSum = 0;
  let visible = 0;
  let path = "";
  let run: string[] = [];
  let runLength = 0;

  for (let index = 0; index < count; index += 1) {
    const lon = ring[index * 2]!;
    const lat = ring[index * 2 + 1]!;
    const phi = lat * RAD;
    const lambda = lon * RAD;
    const cosPhi = Math.cos(phi);
    const vx = cosPhi * Math.cos(lambda);
    const vy = cosPhi * Math.sin(lambda);
    const vz = Math.sin(phi);
    const y = camera.m[3]! * vx + camera.m[4]! * vy + camera.m[5]! * vz;
    if (y <= 0) {
      if (runLength > 1) {
        // Close the run along the limb: a straight chord here is inside the disc by a hair, which
        // is exactly what the limb looks like at this scale.
        path += `M${run.join("L")}Z`;
      }
      run = [];
      runLength = 0;
      continue;
    }
    visible += 1;
    depthSum += y;
    const x = camera.m[0]! * vx + camera.m[1]! * vy + camera.m[2]! * vz;
    const z = camera.m[6]! * vx + camera.m[7]! * vy + camera.m[8]! * vz;
    const sx = coord(camera.cx + camera.radius * x);
    const sy = coord(camera.cy - camera.radius * z);
    run.push(`${sx} ${sy}`);
    runLength += 1;
  }

  // The ring is closed: if it started on the near side, join the last run back to the first.
  if (runLength > 1) {
    path += `M${run.join("L")}Z`;
  }

  if (!path) return null;
  const visibleFraction = visible / count;
  // A ring mostly behind the limb that still has a sliver on the near side is drawn (it is the
  // near face of the continent), but its shading uses the *visible* mean depth.
  return {
    path,
    depth: visible > 0 ? depthSum / visible : 0,
    visibleFraction,
  };
}

/**
 * Day/night shading: the sun sits up and to the left of the viewer, so a point's brightness is its
 * dot product with a fixed light direction, clamped to a floor so the dark limb stays readable
 * (this is an air-travel product, not a planetarium).
 */
const LIGHT: Vec3 = (() => {
  const x = -0.45;
  const y = 0.75;
  const z = 0.48;
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
})();

/** Brightness for a surface point, given its camera-space normal (approximately the vertex). */
export function lightAt(v: Vec3): number {
  const dot = v.x * LIGHT.x + v.y * LIGHT.y + v.z * LIGHT.z;
  return Math.min(1, Math.max(0.18, dot * 0.85 + 0.42));
}

/**
 * The flight path as a real 3D curve.
 *
 * Two arcs stacked, because both are true and they answer different questions:
 *
 *   • the **ground track** is the great circle, drawn flat on the sphere: that is where the plane
 *     actually goes over the Earth;
 *   • the **flight arc** is the same great circle lifted onto a shell of radius `1 + h` (h up to
 *     ~6% of the radius): the classic "route drawn above the planet" — it makes the path legible
 *     where it crosses water, shows the direction of travel at a glance, and gives the moving plane
 *     somewhere to sit. The altitude is exaggerated and labelled as such in the caption, never
 *     presented as a measurement.
 *
 * Both are sampled in *angle* along the great circle, so a long haul bows the way it really does.
 */
export interface ArcPoint {
  /** Position in camera space on the lifted shell. */
  v: Vec3;
  /** The same point on the sphere (for the ground track and for raising the label). */
  ground: Vec3;
  /** 0 at origin, 1 at destination. */
  t: number;
  /** Near side of the shell (visible) or behind it. */
  visible: boolean;
}

export interface FlightArc {
  points: ArcPoint[];
  /** Screen-space path segments, split where the arc passes behind the horizon. */
  path: string;
  /** Ground-track segments, likewise split. */
  groundPath: string;
  /** Highest lift used, in globe radii, for the caption and for sizing the marker. */
  lift: number;
  origin: Vec3;
  destination: Vec3;
  originVisible: boolean;
  destinationVisible: boolean;
}

/** Fraction of the sphere radius the arc is lifted — 0 for a hop, more for a long haul. */
export function arcLift(angleDeg: number): number {
  // A 700 km domestic hop barely needs lift; a 6,000 km haul needs a lot to stay readable over the
  // land it crosses. 0.008 … 0.07 of the radius.
  return Math.min(0.07, 0.008 + (angleDeg / 180) * 0.062);
}

export function flightArc(
  origin: Point,
  destination: Point,
  angleDeg: number,
  camera: Camera,
  samples = 120,
): FlightArc {
  const a = toVec(origin[0], origin[1]);
  const b = toVec(destination[0], destination[1]);
  const lift = arcLift(angleDeg);
  const points: ArcPoint[] = [];

  /** Normalised lerp of two unit vectors is the great circle (slerp) once re-normalised. */
  const along = (t: number): Vec3 => {
    const x = a.x * (1 - t) + b.x * t;
    const y = a.y * (1 - t) + b.y * t;
    const z = a.z * (1 - t) + b.z * t;
    const length = Math.hypot(x, y, z) || 1;
    return { x: x / length, y: y / length, z: z / length };
  };

  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const ground = rotate(camera.m, along(t));
    // Lift along the surface normal: the arc rises radially out of the sphere.
    const v = { x: ground.x * (1 + lift), y: ground.y * (1 + lift), z: ground.z * (1 + lift) };
    points.push({ v, ground, t, visible: v.y > 0 });
  }

  const screen = (v: Vec3): string =>
    `${Math.round(camera.cx + camera.radius * v.x)} ${Math.round(camera.cy - camera.radius * v.z)}`;

  const build = (pick: (point: ArcPoint) => Vec3, visible: (point: ArcPoint) => boolean): string => {
    let path = "";
    let run: string[] = [];
    for (const point of points) {
      if (!visible(point)) {
        if (run.length > 1) path += `M${run.join("L")}`;
        run = [];
        continue;
      }
      run.push(screen(pick(point)));
    }
    if (run.length > 1) path += `M${run.join("L")}`;
    return path;
  };

  // The ground track is clipped by the sphere's horizon; the lifted arc by the shell's, which is a
  // slightly wider circle — the arc leaves the disc a little later than the land does.
  const originRotated = rotate(camera.m, a);
  const destinationRotated = rotate(camera.m, b);

  return {
    points,
    path: build((point) => point.v, (point) => point.v.y > 0),
    groundPath: build((point) => point.ground, (point) => point.ground.y > 0),
    lift,
    origin: originRotated,
    destination: destinationRotated,
    originVisible: originRotated.y > 0,
    destinationVisible: destinationRotated.y > 0,
  };
}

/**
 * Where the plane sits on the arc: the lifted point, plus the screen-space heading so the marker can
 * be rotated to follow the path. Returns null while the plane is behind the shell.
 */
export function planeAt(arc: FlightArc, t: number, camera: Camera): { at: [number, number]; angle: number } | null {
  const index = Math.max(1, Math.min(arc.points.length - 1, Math.round(t * (arc.points.length - 1))));
  const current = arc.points[index];
  const previous = arc.points[index - 1];
  if (!current || !previous || !current.v.y || current.v.y <= 0) return null;
  const x = camera.cx + camera.radius * current.v.x;
  const y = camera.cy - camera.radius * current.v.z;
  const px = camera.cx + camera.radius * previous.v.x;
  const py = camera.cy - camera.radius * previous.v.z;
  const angle = (Math.atan2(y - py, x - px) * 180) / Math.PI;
  return { at: [x, y], angle };
}
