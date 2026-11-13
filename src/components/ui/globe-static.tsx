import { distanceKm, type Point } from "@/lib/geo";
import { flightArc, projectRing, rotationMatrix } from "@/lib/globe3d";
import { COAST } from "@/lib/land";

/**
 * The no-JavaScript globe.
 *
 * `GlobeScene` already renders a full SVG on the server, so a visitor without JavaScript is never
 * left with an empty box. This is the explicit `<noscript>` fallback: the same coastline data, the
 * same orthographic camera and the same great-circle arc, drawn once as a still figure. It lives
 * in its own server component (no `"use client"`) so it cannot accidentally depend on hydration.
 *
 * It is deliberately compact: the whole-planet coastline tier, simplified in screen space to whole
 * pixels, one path per ring, no animation, no controls. A `<noscript>` style rule in the wrapper hides the interactive figure when scripting is
 * off, so the visitor sees exactly one globe.
 */

export interface GlobeStaticProps {
  origin: Point;
  destination: Point;
  originLabel: string;
  destinationLabel: string;
}

const SIZE = 340;
const R = 152;
const C = SIZE / 2;

/** Longitude halfway along the short way round (antimeridian-safe). */
function midpoint(a: number, b: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return a + delta / 2;
}

export function GlobeStatic({
  origin,
  destination,
  originLabel,
  destinationLabel,
}: GlobeStaticProps) {
  const km = distanceKm(origin, destination);
  const spanDeg = Math.min((km / 6371) * (180 / Math.PI), 175);
  // Cap the still figure at the detail tier that is already decoded on the server.
  const zoom = Math.min(
    Math.max(1, 0.62 / Math.sin((spanDeg * Math.PI) / 360)),
    3.5,
  );
  const centre: Point = [
    midpoint(origin[0], destination[0]),
    (origin[1] + destination[1]) / 2,
  ];
  const camera = {
    m: rotationMatrix({ yaw: centre[0], pitch: centre[1], roll: 1.5 }),
    radius: R * zoom,
    cx: C,
    cy: C,
  };

  const rings = COAST[1]
    .map((ring) => projectRing(ring, camera))
    .filter((ring): ring is NonNullable<typeof ring> => ring !== null)
    .map((ring) => ({ ...ring, path: compact(ring.path, 0.6) }))
    .filter((ring) => ring.path !== "")
    .sort((a, b) => a.depth - b.depth);

  const arc = flightArc(origin, destination, spanDeg, camera, 90);
  const arcPath = compact(arc.path, 0.4);
  const screen = (v: { x: number; z: number }) => [
    C + camera.radius * v.x,
    C - camera.radius * v.z,
  ];
  const [ox, oy] = screen(arc.origin);
  const [dx, dy] = screen(arc.destination);

  return (
    <figure
      className="noscript-globe mx-auto w-full max-w-[22rem]"
      data-globe="static"
      role="img"
      aria-label={`مسیر ${originLabel} به ${destinationLabel} روی کرهٔ زمین`}
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-auto w-full">
        <title>{`مسیر ${originLabel} → ${destinationLabel} روی کرهٔ زمین`}</title>
        <defs>
          <radialGradient id="globe-static-ocean" cx="34%" cy="28%" r="90%">
            <stop offset="0%" stopColor="#3f9d92" />
            <stop offset="60%" stopColor="#256f67" />
            <stop offset="100%" stopColor="#0d3f3a" />
          </radialGradient>
          <radialGradient id="globe-static-land" cx="30%" cy="20%" r="95%">
            <stop offset="0%" stopColor="#f6f9ef" />
            <stop offset="100%" stopColor="#b8cfc0" />
          </radialGradient>
          <clipPath id="globe-static-clip">
            <circle cx={C} cy={C} r={R} />
          </clipPath>
        </defs>
        <circle cx={C} cy={C} r={R * 1.03} fill="#2f9d8e" fillOpacity="0.18" />
        <circle cx={C} cy={C} r={R} fill="url(#globe-static-ocean)" />
        <g clipPath="url(#globe-static-clip)">
          <g
            stroke="#0d4b45"
            strokeOpacity="0.16"
            strokeWidth="0.6"
            fill="url(#globe-static-land)"
          >
            {rings.map((ring, index) => (
              <path
                key={index}
                d={ring.path}
                fillOpacity={0.65 + 0.35 * Math.min(1, ring.depth * 1.3)}
              />
            ))}
          </g>
          <path
            d={arcPath}
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.9"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <path
            d={arcPath}
            fill="none"
            stroke="#0f8a78"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="10 6"
          />
        </g>
        <circle cx={C} cy={C} r={R} fill="#02201c" fillOpacity="0.06" />
        <circle
          cx={C}
          cy={C}
          r={R}
          fill="none"
          stroke="#eafaf7"
          strokeOpacity="0.5"
        />
        {arc.originVisible && (
          <circle
            cx={ox}
            cy={oy}
            r="4"
            fill="#0f8a78"
            stroke="#ffffff"
            strokeWidth="2"
          />
        )}
        {arc.destinationVisible && (
          <circle
            cx={dx}
            cy={dy}
            r="4"
            fill="#c2740b"
            stroke="#ffffff"
            strokeWidth="2"
          />
        )}
      </svg>
      <figcaption className="mt-3 text-center text-[0.66rem] leading-5 text-ink-500">
        نمای ثابت کرهٔ زمین و مسیر {originLabel} → {destinationLabel}. برای
        چرخاندن کره، جاوااسکریپت مرورگر را روشن کنید.
      </figcaption>
    </figure>
  );
}

/**
 * Ramer–Douglas–Peucker in *screen* space, then integer coordinates.
 *
 * A no-JS figure is downloaded by every visitor whether they need it or not, so it must stay small:
 * at 0.6 px tolerance a 340 px disc keeps its fjords and gulfs but drops the sub-pixel vertices.
 */
function compact(path: string, tolerance: number): string {
  let out = "";
  // Coastline rings end with `Z`; the flight arc is an open run and may be split into several `M`s.
  for (const chunk of path.split("M").slice(1)) {
    const closed = chunk.endsWith("Z");
    const body = closed ? chunk.slice(0, -1) : chunk;
    const numbers = body.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const points: [number, number][] = [];
    for (let index = 0; index + 1 < numbers.length; index += 2) {
      points.push([numbers[index]!, numbers[index + 1]!]);
    }
    const kept = simplify(points, tolerance);
    if (kept.length < 2) continue;
    out += `M${kept.map(([x, y]) => `${Math.round(x)} ${Math.round(y)}`).join("L")}${closed ? "Z" : ""}`;
  }
  return out;
}

function simplify(
  points: [number, number][],
  tolerance: number,
): [number, number][] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const [x1, y1] = points[first]!;
    const [x2, y2] = points[last]!;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    let farthest = -1;
    let maxDistance = 0;
    for (let index = first + 1; index < last; index += 1) {
      const [px, py] = points[index]!;
      const distance = length
        ? Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / length
        : Math.hypot(px - x1, py - y1);
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
