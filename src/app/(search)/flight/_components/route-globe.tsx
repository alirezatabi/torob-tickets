import {
  bearing,
  distanceKm,
  greatCirclePath,
  orthographic,
  routeCentre,
  runToPath,
  visibleRuns,
  type Point,
} from "@/lib/geo";
import mapData from "@/lib/map/countries-50m.json";
import { cn } from "@/lib/cn";
import { toPersianDigits } from "@/lib/format";

/**
 * The globe on a ticket page.
 *
 * Why a real orthographic projection instead of a static image: the route has to be drawn, the
 * viewer has to see *which way round the Earth* the flight goes (Tehran → Istanbul heads
 * north-west, not straight left), and the drawing has to be honest about distance. So the
 * countries come from Natural Earth (public domain, generated once into `lib/map/countries-50m.json`,
 * ships with the repo, no dependency at runtime), the arc is the
 * **great circle** between the two airports, and everything is projected server-side into one
 * inline SVG — no tiles, no network, no client JavaScript, no layout shift, and nothing to
 * fail offline.
 *
 * The disc is centred on the route (the midpoint of the great circle) and scaled so the flight
 * always fills a readable share of it: short hops zoom in, long hauls show more of the planet.
 * That is deliberate — a fixed world view turns a 700 km domestic hop into a two-pixel dot.
 */

/** GeoJSON-ish rings, typed loosely: the file is generated data, not a hand-written contract. */
const MAP = mapData as unknown as { countries: { name: string; rings: number[][][] }[] };

const SIZE = 340;
const RADIUS = 152;
const C = SIZE / 2;

export interface GlobeProps {
  origin: Point;
  destination: Point;
  originLabel: string;
  destinationLabel: string;
  className?: string;
}

export function Globe({ origin, destination, originLabel, destinationLabel, className }: GlobeProps) {
  const km = distanceKm(origin, destination);
  const centrePoint = routeCentre(origin, destination);

  // An orthographic projection maps the visible hemisphere onto `R`, so a route spanning
  // `span` degrees covers `R · sin(span/2)` on screen. Two view modes follow from that:
  //
  //  · a long haul is drawn on the **whole globe** (R fills the disc) — the point is to see
  //    which way round the planet the flight goes;
  //  · a short hop can never be read on a whole globe (700 km is 6.3°, i.e. a couple of
  //    pixels), so we zoom: `R` grows past the disc and the horizon circle becomes a clean,
  //    fully-inside ring of the region — a porthole onto the planet, not a lie about its
  //    curvature.
  const spanDeg = Math.min((km / 6371) * (180 / Math.PI), 175);
  const zoom = Math.max(1, Math.min(14, 0.62 / Math.sin((spanDeg * Math.PI) / 360)));
  const fullGlobe = zoom <= 1.0001;
  const radius = RADIUS * zoom;
  // Project at the zoomed radius and clip to the fixed circle: at zoom 1 the clip is the true
  // horizon, above it the clip is a porthole of `asin(1/zoom)` degrees around the route.
  const projection = orthographic(centrePoint, radius, C, C);

  /** Projected coordinates already live in the on-screen disc — no rescaling needed. */
  const screen = (point: Point): Point => point;

  const countries = MAP.countries
    .map((country) => ({
      name: country.name,
      paths: country.rings
        .flatMap((ring) => visibleRuns(ring.map(([lon, lat]) => [lon ?? 0, lat ?? 0] as Point), projection))
        // A 0.35 px tolerance is invisible at this size and removes most of the vertices: the
        // full 1:50m coastline would otherwise ship ~500 kB of path data per ticket page.
        .map((run) => simplifyRun(run, 0.35))
        .map(runToPath),
    }))
    .filter((country) => country.paths.length > 0);

  const arc = greatCirclePath(origin, destination, projection, 240);
  const from = projection.project(origin);
  const to = projection.project(destination);
  const heading = Math.round(bearing(origin, destination));
  const gridStep = zoom >= 6 ? 2 : zoom >= 3 ? 5 : 15;
  const showGrid = zoom <= 6;
  const rimOpacity = fullGlobe ? 0.42 : 0.22;

  return (
    <figure className={cn("relative", className)} data-testid="route-globe">
      <div className="relative mx-auto aspect-square w-full max-w-[21rem]">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-auto w-full overflow-visible"
          role="img"
          aria-label={`کرهٔ زمین با مسیر تقریبی ${originLabel} به ${destinationLabel}`}
        >
          <title>{`مسیر تقریبی ${originLabel} → ${destinationLabel}`}</title>
          <defs>
            <radialGradient id="globe-ocean" cx="34%" cy="26%" r="80%">
              <stop offset="0%" stopColor="#f4fcfb" />
              <stop offset="46%" stopColor="#e2f3f1" />
              <stop offset="100%" stopColor="#c2dcd8" />
            </radialGradient>
            <radialGradient id="globe-shade" cx="32%" cy="24%" r="88%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
              <stop offset="42%" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="100%" stopColor="#04231f" stopOpacity="0.34" />
            </radialGradient>
            <linearGradient id="globe-land" x1="0" y1="0" x2="0.35" y2="1">
              <stop offset="0%" stopColor="#7cc4bc" />
              <stop offset="100%" stopColor="#4f9a92" />
            </linearGradient>
            <linearGradient id="globe-arc" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#0f8a78" />
              <stop offset="100%" stopColor="#b45309" />
            </linearGradient>
            <clipPath id="globe-clip">
              <circle cx={C} cy={C} r={RADIUS} />
            </clipPath>
            <filter id="globe-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <circle cx={C} cy={C} r={RADIUS} fill="url(#globe-ocean)" />

          <g clipPath="url(#globe-clip)">
            {showGrid && (
              <g stroke="#0a4d47" strokeOpacity="0.13" strokeWidth="0.55" fill="none">
                {graticule(projection, gridStep).map((path, index) => (
                  <path key={`grid-${index}`} d={path} />
                ))}
              </g>
            )}

            <g fill="url(#globe-land)" stroke="#0a4d47" strokeOpacity="0.35" strokeWidth="0.6">
              {countries.flatMap((country) =>
                country.paths.map((path, index) => <path key={`${country.name}-${index}`} d={path} />),
              )}
            </g>

            <g fill="none" strokeLinecap="round">
              <path d={arc.path} stroke="#ffffff" strokeOpacity="0.92" strokeWidth="7" />
              <path
                d={arc.path}
                stroke="url(#globe-arc)"
                strokeWidth="3.4"
                strokeDasharray="10 7"
                filter="url(#globe-glow)"
              />
            </g>

            {arrowOnRoute(arc.visibleSamples, screen)}
            {from && <Endpoint point={screen(from)} color="#0f8a78" />}
            {to && <Endpoint point={screen(to)} color="#b45309" />}
            {from && <PointLabel point={screen(from)} text={originLabel} align="start" tone="#0a4d47" />}
            {to && <PointLabel point={screen(to)} text={destinationLabel} align="end" tone="#92400e" />}
          </g>

          {fullGlobe && (
            <circle cx={C} cy={C} r={RADIUS} fill="url(#globe-shade)" pointerEvents="none" />
          )}
          <circle
            cx={C}
            cy={C}
            r={RADIUS}
            fill="none"
            stroke="#0d6b60"
            strokeOpacity={rimOpacity}
            strokeWidth="1"
            pointerEvents="none"
          />
        </svg>
      </div>

      <figcaption className="mt-3 space-y-1.5 text-center">
        <p className="nums text-[0.68rem] text-ink-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-teal-600" aria-hidden="true" />
            {originLabel}
          </span>
          <span className="mx-2 text-ink-300">←</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-saffron-600" aria-hidden="true" />
            {destinationLabel}
          </span>
        </p>
        <p className="nums text-[0.66rem] text-ink-500">
          {toPersianDigits(Math.round(km / 10) * 10)} کیلومتر
          <span className="mx-1.5 text-ink-300">·</span>
          دایرة‌المعارف بزرگ
          <span className="mx-1.5 text-ink-300">·</span>
          جهت {toPersianDigits(heading)}°
        </p>
        <p className="text-[0.6rem] leading-5 text-ink-400">
          نمای تقریبی و بزرگ‌نمایی‌شده؛ مرکز کره وسط مسیر است، پس پروازهای کوتاه بزرگ‌تر دیده می‌شوند.
        </p>
      </figcaption>
    </figure>
  );
}

function Endpoint({ point, color }: { point: Point; color: string }) {
  const [x, y] = point;
  return (
    <g>
      <circle cx={x} cy={y} r="9" fill={color} fillOpacity="0.16" />
      <circle cx={x} cy={y} r="4.4" fill={color} stroke="#fff" strokeWidth="1.7" />
    </g>
  );
}

/** Airline-style label beside a point, with a white halo so it survives over land or water. */
function PointLabel({
  point,
  text,
  align,
  tone,
}: {
  point: Point;
  text: string;
  align: "start" | "end";
  tone: string;
}) {
  const [x, y] = point;
  const dx = align === "start" ? 9 : -9;
  const anchor = align === "start" ? "start" : "end";
  return (
    <text
      x={x + dx}
      y={y + 3.5}
      textAnchor={anchor}
      fontSize="9"
      fontWeight="700"
      fill={tone}
      stroke="#ffffff"
      strokeWidth="2.6"
      paintOrder="stroke"
      strokeLinejoin="round"
      style={{ fontFamily: "var(--font-sans), system-ui, sans-serif" }}
    >
      {text}
    </text>
  );
}

/**
 * Ramer–Douglas–Peucker in screen space. At globe scale, most coastline vertices land within
 * a third of a pixel of the segment between their neighbours, so dropping them costs nothing
 * visually and cuts the markup by an order of magnitude.
 */
function simplifyRun(points: Point[], tolerance: number): Point[] {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let farthest = -1;
    let maxDistance = 0;
    const [x1, y1] = points[first]!;
    const [x2, y2] = points[last]!;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;

    for (let index = first + 1; index < last; index += 1) {
      const [px, py] = points[index]!;
      let distance: number;
      if (lengthSquared === 0) {
        distance = Math.hypot(px - x1, py - y1);
      } else {
        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
        distance = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
      }
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

  const simplified = points.filter((_, index) => keep[index] === 1);
  return simplified.length >= 3 ? simplified : points;
}

/** Latitude circles and meridians, projected and clipped like any other geometry. */
function graticule(projection: ReturnType<typeof orthographic>, step: number): string[] {
  const paths: string[] = [];
  const latitudes: number[] = [];
  const longitudes: number[] = [];
  for (let lat = -60; lat <= 60; lat += step) latitudes.push(lat);
  for (let lon = -180; lon < 180; lon += step) longitudes.push(lon);

  for (const lat of latitudes) {
    const ring: Point[] = [];
    for (let lon = -180; lon <= 180; lon += 4) ring.push([lon, lat]);
    for (const run of visibleRuns(ring, projection)) {
      paths.push(`M${run.map(([x, y]) => `${x} ${y}`).join("L")}`);
    }
  }
  for (const lon of longitudes) {
    const ring: Point[] = [];
    for (let lat = -88; lat <= 88; lat += 4) ring.push([lon, lat]);
    for (const run of visibleRuns(ring, projection)) {
      paths.push(`M${run.map(([x, y]) => `${x} ${y}`).join("L")}`);
    }
  }
  return paths;
}

/** A small arrowhead on the middle of the visible track, pointing along the travel direction. */
function arrowOnRoute(samples: { point: Point; t: number }[], screen: (point: Point) => Point) {
  if (samples.length < 6) return null;
  const middle = Math.floor(samples.length / 2);
  const at = samples[middle];
  const ahead = samples[Math.min(samples.length - 1, middle + 2)];
  const behind = samples[Math.max(0, middle - 2)];
  if (!at || !ahead || !behind) return null;
  const target = ahead.t > at.t ? ahead : behind;
  const [x1, y1] = screen(at.point);
  const [x2, y2] = screen(target.point);
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  if (!Number.isFinite(angle)) return null;
  return (
    <g transform={`translate(${x1} ${y1}) rotate(${angle})`}>
      <path d="M-4.5 -4 L5.5 0 L-4.5 4 L-2 0 Z" fill="#0d6b60" stroke="#fff" strokeWidth="1" />
    </g>
  );
}
