/**
 * The interactive ticket globe: view logic only, no React and no DOM.
 *
 * The ticket page's globe is now a small 3D model of the Earth computed in the browser: every
 * frame the disc is re-projected with the same orthographic maths the server uses, so the land,
 * the great-circle route and both airports stay glued to the sphere while it turns. Keeping the
 * maths in this one pure module means the behaviour can be unit-tested (no canvas, no browser)
 * and that the drawing code in the component stays short enough to read.
 *
 * Why not an actual WebGL sphere: the coastline data is already in the bundle, an SVG disc of
 * ~300 px does not need a GPU, and projecting 9k vertices per frame is cheaper than shipping a
 * rendering engine. This is honest 3D projection (front faces, depth-ordered), not a rotated image.
 */

import { interpolate, orthographic, routeCentre, visibleRuns, type Point } from "@/lib/geo";

/** [lon, lat] rings, the shape of `src/lib/map/land-1deg.json`. */
export type LandRing = readonly (readonly [number, number])[];

export interface GlobeViewOptions {
  /** Which way round the planet we are looking (degrees east). */
  yaw: number;
  /** How far up/down the camera sits (degrees of latitude). */
  pitch: number;
  /** Disc radius in viewBox units. */
  radius: number;
  /** Centre of the disc in viewBox units. */
  cx: number;
  cy: number;
}

/**
 * The centre of the projection: longitude from the yaw, latitude from the pitch.
 *
 * Both are needed — a globe centred on the route has to sit at the route's own latitude as well
 * as its longitude, otherwise a northern domestic hop ends up near the rim of the zoomed disc.
 * The pitch is clamped just short of the poles, where the orthographic projection degenerates.
 */
export function viewCentre(options: GlobeViewOptions): Point {
  return [normalizeLon(options.yaw), Math.max(-78, Math.min(78, options.pitch))];
}

/** Latitude of the visible rim at a given yaw — used to fade the terminator. */
export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export interface ProjectedRoute {
  /** Sampled great circle in screen space. */
  points: Point[];
  /** Same samples in geographic space (for labels/edges if ever needed). */
  geo: Point[];
  /** Index range of the arc that is currently hidden behind the horizon. */
  hidden: boolean[];
  origin: Point | null;
  destination: Point | null;
  visibleFraction: number;
}

/**
 * Project the great-circle route for the current view.
 *
 * The arc is sampled once per call in *angle* (not longitude), so the polyline follows the real
 * track; points behind the horizon are flagged instead of drawn, exactly like the land.
 */
export function projectRoute(
  origin: Point,
  destination: Point,
  options: GlobeViewOptions,
  samples = 96,
): ProjectedRoute {
  const projection = orthographic(viewCentre(options), options.radius, options.cx, options.cy);
  const points: Point[] = [];
  const geo: Point[] = [];
  const hidden: boolean[] = [];

  for (let index = 0; index <= samples; index += 1) {
    const point = interpolate(origin, destination, index / samples);
    const projected = projection.project(point);
    if (projected) {
      points.push(projected);
      geo.push(point);
      hidden.push(false);
    } else {
      // Keep the index in step with the sample number so the arc can be split where it dips
      // below the horizon. The previous visible point is repeated to keep a drawable segment.
      const last = points[points.length - 1];
      if (last) points.push(last);
      else points.push([options.cx, options.cy]);
      geo.push(point);
      hidden.push(true);
    }
  }

  const originProjected = projection.project(origin);
  const destinationProjected = projection.project(destination);
  const visibleFraction = hidden.filter((value) => !value).length / hidden.length;

  return {
    points,
    geo,
    hidden,
    origin: originProjected,
    destination: destinationProjected,
    visibleFraction,
  };
}

/**
 * Split the projected land into drawable runs for this view.
 *
 * `visibleRuns` already cuts a ring where it dips behind the horizon (drawing a chord across the
 * disc is the classic orthographic artefact), so a continent that wraps the limb stays smooth.
 */
export function projectLand(rings: readonly LandRing[], options: GlobeViewOptions): string[] {
  const projection = orthographic(viewCentre(options), options.radius, options.cx, options.cy);
  const paths: string[] = [];

  for (const ring of rings) {
    const points: Point[] = [];
    for (const [lon, lat] of ring) points.push([lon, lat]);
    for (const run of visibleRuns(points, projection)) {
      paths.push(`M${run.map(([x, y]) => `${x} ${y}`).join("L")}Z`);
    }
  }
  return paths;
}

/** A graticule for the current view: meridians and parallels, clipped to the disc. */
export function projectGraticule(options: GlobeViewOptions, step = 20): string[] {
  const projection = orthographic(viewCentre(options), options.radius, options.cx, options.cy);
  const paths: string[] = [];
  const toPath = (run: Point[]) => `M${run.map(([x, y]) => `${x} ${y}`).join("L")}`;

  for (let lat = -60; lat <= 60; lat += step) {
    const ring: Point[] = [];
    for (let lon = -180; lon <= 180; lon += 4) ring.push([lon, lat]);
    for (const run of visibleRuns(ring, projection)) paths.push(toPath(run));
  }
  for (let lon = -180; lon < 180; lon += step) {
    const ring: Point[] = [];
    for (let lat = -88; lat <= 88; lat += 4) ring.push([lon, lat]);
    for (const run of visibleRuns(ring, projection)) paths.push(toPath(run));
  }
  return paths;
}

/**
 * The initial view: put the route in the middle, then choose a zoom that fills the disc.
 *
 * Same rule as the server-rendered version — the orthographic projection compresses a route of
 * `span` degrees to `R·sin(span/2)` on screen, so a 700 km domestic hop needs a magnified
 * porthole while a long haul reads best on the whole planet.
 */
export function initialView(origin: Point, destination: Point, km: number, size: number, radius: number) {
  const spanDeg = Math.min((km / 6371) * (180 / Math.PI), 175);
  // Capped at 4.5: the thinned coastline (~0.12° between vertices) stops resolving a short hop
  // beyond about this magnification, and the disc starts showing the data's resolution instead of
  // the planet's shape. At 4.5 a 700 km domestic flight is still a clear, labelled arc across the
  // middle of the porthole.
  const zoom = Math.max(1, Math.min(4.5, 0.62 / Math.sin((spanDeg * Math.PI) / 360)));
  const centre = routeCentre(origin, destination);
  return {
    yaw: centre[0],
    pitch: centre[1],
    centre,
    zoom,
    radius: radius * zoom,
    cx: size / 2,
    cy: size / 2,
  };
}
