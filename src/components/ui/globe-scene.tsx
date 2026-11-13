"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { distanceKm, type Point } from "@/lib/geo";
import {
  COAST,
  coastLevel,
  loadCoast,
  type CoastLevel,
  type Ring,
} from "@/lib/land";
import {
  flightArc,
  planeAt,
  projectRing,
  rotationMatrix,
  toVec,
  type Camera,
  type Vec3,
} from "@/lib/globe3d";

/**
 * The globe. One component, two jobs:
 *
 *   • on a ticket page it draws a *route*: the great circle, its label, two airports, a plane that
 *     flies it once on arrival;
 *   • in the hero it draws a *planet*: no route, just a slowly turning Earth.
 *
 * Both are the same three-dimensional model — the coastline is rotated in 3D and culled by the
 * horizon every frame — and both are pure SVG, so nothing has to be a canvas, a texture or a video.
 *
 * What makes it read as a real object rather than a drawn circle:
 *   • a real rotation matrix (yaw, pitch, and a couple of degrees of roll) applied per vertex;
 *   • per-ring depth sorting, so near coastlines sit on top of far ones;
 *   • per-ring shading from the vertex depth — the far limb darkens, the near face catches the light;
 *   • a rim of atmosphere and a soft terminator, both driven by the same geometry;
 *   • motion with inertia: drag spins it, releasing lets it coast, and the idle state is a slow sway
 *     (or a full turn in the hero) — clamped so the route never leaves the disc.
 *
 * Detail is chosen per frame from the zoom (`coastLevel`), and the finest tier is a lazy import, so
 * the front page never downloads the magnified coastline.
 */

export interface GlobeSceneProps {
  /** Route mode when both are given, planet mode otherwise. */
  origin?: Point;
  destination?: Point;
  originLabel?: string;
  destinationLabel?: string;
  size?: number;
  /** Hero mode: a full, slow rotation with no route and no controls. */
  planet?: boolean;
  /** Seconds for a full revolution in planet mode. */
  period?: number;
  /** Draw the controls (pause / reset). Off for the hero, which has no state to reset. */
  controls?: boolean;
  className?: string;
  /** Extra caption lines under the disc (route mode supplies its own). */
  caption?: React.ReactNode;
}

const DISC = 0.9; // disc radius as a fraction of the viewbox, leaving room for the halo
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

export function GlobeScene({
  origin,
  destination,
  originLabel = "",
  destinationLabel = "",
  size = 360,
  planet = false,
  period = 96,
  controls = false,
  className,
  caption,
}: GlobeSceneProps) {
  const radius = size * 0.5 * DISC;
  const cx = size / 2;
  const cy = size / 2;

  // A stable route object. The props are fresh arrays on every render, and re-projecting the whole
  // globe per render would be wasteful; only the four coordinates actually matter.
  const originLon = origin?.[0] ?? Number.NaN;
  const originLat = origin?.[1] ?? Number.NaN;
  const destinationLon = destination?.[0] ?? Number.NaN;
  const destinationLat = destination?.[1] ?? Number.NaN;
  const hasRoute =
    !planet && Number.isFinite(originLon) && Number.isFinite(destinationLon);
  const route = useMemo(
    () =>
      hasRoute
        ? {
            origin: [originLon, originLat] as Point,
            destination: [destinationLon, destinationLat] as Point,
          }
        : null,
    [hasRoute, originLon, originLat, destinationLon, destinationLat],
  );
  const km = useMemo(
    () => (route ? distanceKm(route.origin, route.destination) : 0),
    [route],
  );
  const centre = useMemo<Point>(() => {
    if (!route) return [52, 24];
    // Midpoint of the great circle: the route sits in the middle of the disc, antimeridian-safe.
    return [
      midpointLon(route.origin[0], route.destination[0]),
      (route.origin[1] + route.destination[1]) / 2,
    ];
  }, [route]);

  /** Zoom that makes the route fill a readable share of the disc (see docs/REPORT-02 §۱۲). */
  const baseZoom = useMemo(() => {
    if (!route) return 1;
    const spanDeg = Math.min((km / 6371) * (180 / Math.PI), 175);
    return clamp(
      0.62 / Math.sin((spanDeg * Math.PI) / 360),
      MIN_ZOOM,
      MAX_ZOOM,
    );
  }, [route, km]);

  const [yaw, setYaw] = useState(planet ? 52 : centre[0]);
  const [pitch, setPitch] = useState(planet ? 22 : centre[1]);
  /**
   * The server's first paint is the whole planet with the whole route, drawn from the one tier that
   * is already decoded at module load. That keeps the HTML small, makes the first client frame
   * byte-identical to the server frame, and gives no-JS visitors a complete drawing (the explicit
   * `<noscript>` figure is separately simplified in screen space to keep its HTML compact). The zoom-in intro runs only after the
   * detail this framing needs has arrived — never the other way round, which is what used to flash
   * a giant polygon for a few hundred milliseconds.
   */
  const initialZoom = 1;
  const initialLevel: CoastLevel = 1;
  const [zoom, setZoom] = useState(initialZoom);
  const [progress, setProgress] = useState(1);
  const [spinning, setSpinning] = useState(true);
  const [level, setLevel] = useState<CoastLevel>(initialLevel);
  const [reduced, setReduced] = useState(false);
  /** Server and first client paint are identical; this flips once if the visitor asked for less motion. */

  const drag = useRef<{
    x: number;
    y: number;
    yaw: number;
    pitch: number;
    vx: number;
    vy: number;
  } | null>(null);
  const inertia = useRef({ yaw: 0, pitch: 0 });
  const touched = useRef(false);
  const phase = useRef(Math.random() * Math.PI * 2);
  const frame = useRef<number | null>(null);
  const startYaw = useRef(planet ? 52 : centre[0]);
  const startPitch = useRef(planet ? 22 : centre[1]);

  /**
   * Reduced motion is decided on the client (the server cannot know), and it starts *off* so the
   * server HTML and the first client paint are byte-identical — an animation that begins on the
   * first frame and stops a tick later is worse than one that never starts.
   *
   * `window.matchMedia` is also absent in some renderers (jsdom without the polyfill), which must
   * not break the page: no `matchMedia` simply means "motion is fine".
   */
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  /**
   * Route intro: load the detail tier this framing needs, *then* zoom in and fly the plane.
   *
   * Doing it in that order matters: zooming first and fetching afterwards is exactly how a globe
   * ends up showing ten-kilometre polygons for a few hundred milliseconds.
   */
  useEffect(() => {
    if (!route || planet) return;

    let cancelled = false;
    let raf = 0;
    const timers: number[] = [];
    const needed = coastLevel(baseZoom);

    void loadCoast(needed).then((rings) => {
      if (cancelled || rings.length === 0) return;
      setLevel(needed);
      setZoom(baseZoom);

      // A visitor who asked for less motion gets the final, fully detailed frame — no zoom-in,
      // no flying plane, no idle sway.
      if (reduced) {
        setProgress(1);
        return;
      }

      setProgress(0);
      setZoom(baseZoom * 0.6);
      timers.push(window.setTimeout(() => setZoom(baseZoom), 80));

      let begin = 0;
      const duration = 1500;
      const step = (now: number) => {
        if (!begin) begin = now;
        const t = Math.min(1, (now - begin) / duration);
        setProgress(1 - (1 - t) ** 3);
        if (t < 1) raf = requestAnimationFrame(step);
      };
      timers.push(
        window.setTimeout(() => {
          raf = requestAnimationFrame(step);
        }, 260),
      );
    });

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      cancelAnimationFrame(raf);
    };
  }, [route, planet, baseZoom, reduced]);

  // One animation loop: inertia first, then the idle motion.
  useEffect(() => {
    if (reduced) return;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(now - last, 80) / 1000;
      last = now;
      if (document.visibilityState === "visible" && !drag.current) {
        const inertiaMagnitude =
          Math.abs(inertia.current.yaw) + Math.abs(inertia.current.pitch);
        if (inertiaMagnitude > 0.05) {
          setYaw((value) => value + inertia.current.yaw * delta);
          setPitch((value) =>
            clamp(value + inertia.current.pitch * delta, -70, 70),
          );
          const decay = 0.92 ** (delta * 60);
          inertia.current.yaw *= decay;
          inertia.current.pitch *= decay;
        } else if (spinning && !touched.current) {
          if (planet) {
            // A full, slow revolution — the planet is the subject here.
            setYaw((value) => value + (360 / period) * delta);
          } else {
            // A ±9° sway: it shows the sphere is real without carrying the route off the disc.
            phase.current += delta;
            setYaw(startYaw.current + Math.sin(phase.current * 0.5) * 9);
            setPitch(startPitch.current + Math.sin(phase.current * 0.31) * 2.5);
          }
        }
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [reduced, spinning, planet, period]);

  const camera: Camera = useMemo(
    () => ({
      m: rotationMatrix({ yaw, pitch, roll: planet ? 0 : 1.5 }),
      radius: radius * zoom,
      cx,
      cy,
    }),
    [yaw, pitch, zoom, radius, cx, cy, planet],
  );

  const rings = COAST[level];
  const land = useMemo(() => projectLand(rings, camera), [rings, camera]);
  const graticule = useMemo(() => projectGraticule(camera), [camera]);
  const arc = useMemo(
    () =>
      route
        ? flightArc(
            route.origin,
            route.destination,
            (km / 6371) * (180 / Math.PI),
            camera,
            140,
          )
        : null,
    [route, km, camera],
  );
  const plane = arc ? planeAt(arc, progress, camera) : null;

  const onPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (reduced) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        x: event.clientX,
        y: event.clientY,
        yaw,
        pitch,
        vx: 0,
        vy: 0,
      };
      inertia.current = { yaw: 0, pitch: 0 };
      touched.current = true;
    },
    [reduced, yaw, pitch],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const current = drag.current;
      if (!current) return;
      // A drag across the disc is roughly half a turn, which is how a globe on a desk behaves.
      const deltaYaw = ((event.clientX - current.x) / (radius * 2)) * 260;
      const deltaPitch = ((event.clientY - current.y) / (radius * 2)) * 130;
      current.x = event.clientX;
      current.y = event.clientY;
      current.vx = deltaYaw;
      current.vy = -deltaPitch;
      current.yaw += deltaYaw;
      current.pitch = clamp(current.pitch + deltaPitch, -70, 70);
      setYaw(current.yaw);
      setPitch(current.pitch);
    },
    [radius],
  );

  const onPointerUp = useCallback(() => {
    const current = drag.current;
    if (!current) return;
    inertia.current = { yaw: current.vx * 22, pitch: current.vy * 18 };
    drag.current = null;
  }, []);

  const reset = useCallback(() => {
    touched.current = false;
    phase.current = 0;
    inertia.current = { yaw: 0, pitch: 0 };
    setYaw(startYaw.current);
    setPitch(startPitch.current);
    setZoom(planet ? 1 : baseZoom);
  }, [baseZoom, planet]);

  const gradientId = useId("globe");
  const clipId = `${gradientId}-clip`;

  return (
    <figure
      className={className}
      data-globe={planet ? "planet" : "live"}
      data-testid={planet ? undefined : "route-globe"}
    >
      <div
        className="relative mx-auto aspect-square w-full"
        style={{ maxWidth: size }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-[2%] rounded-full bg-teal-500/20 blur-2xl"
          style={{ opacity: 0.55 }}
        />
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className={
            reduced
              ? "h-auto w-full"
              : "h-auto w-full cursor-grab active:cursor-grabbing"
          }
          role="img"
          aria-label={
            route
              ? `کرهٔ زمین سه‌بعدی با مسیر ${originLabel} به ${destinationLabel}`
              : "کرهٔ زمین در حال چرخش"
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <title>
            {route
              ? `مسیر ${originLabel} → ${destinationLabel} روی کرهٔ زمین`
              : "کرهٔ زمین"}
          </title>
          <defs>
            <radialGradient
              id={`${gradientId}-ocean`}
              cx="34%"
              cy="28%"
              r="90%"
            >
              <stop offset="0%" stopColor="#3f9d92" />
              <stop offset="42%" stopColor="#2b7f76" />
              <stop offset="76%" stopColor="#1a5f58" />
              <stop offset="100%" stopColor="#0d3f3a" />
            </radialGradient>
            <radialGradient id={`${gradientId}-land`} cx="30%" cy="20%" r="95%">
              <stop offset="0%" stopColor="#f6f9ef" />
              <stop offset="55%" stopColor="#dbe8d8" />
              <stop offset="100%" stopColor="#b8cfc0" />
            </radialGradient>
            <radialGradient
              id={`${gradientId}-shade`}
              cx="30%"
              cy="22%"
              r="92%"
            >
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.34" />
              <stop offset="38%" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="80%" stopColor="#02201c" stopOpacity="0.26" />
              <stop offset="100%" stopColor="#02201c" stopOpacity="0.52" />
            </radialGradient>
            <linearGradient
              id={`${gradientId}-arc`}
              x1="0"
              y1="0"
              x2="1"
              y2="1"
            >
              <stop offset="0%" stopColor="#34d399" />
              <stop offset="55%" stopColor="#0f8a78" />
              <stop offset="100%" stopColor="#f59e0b" />
            </linearGradient>
            <clipPath id={clipId}>
              <circle cx={cx} cy={cy} r={radius} />
            </clipPath>
            <filter
              id={`${gradientId}-glow`}
              x="-40%"
              y="-40%"
              width="180%"
              height="180%"
            >
              <feGaussianBlur stdDeviation="2.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Atmosphere: a ring that is a real gradient, not a stroke with `opacity`. */}
          <circle
            cx={cx}
            cy={cy}
            r={radius * 1.035}
            fill="#2f9d8e"
            fillOpacity="0.18"
          />
          <circle
            cx={cx}
            cy={cy}
            r={radius * 1.015}
            fill="#5fc4b4"
            fillOpacity="0.16"
          />
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill={`url(#${gradientId}-ocean)`}
          />

          <g clipPath={`url(#${clipId})`}>
            <path
              d={graticule}
              fill="none"
              stroke="#eafaf7"
              strokeOpacity="0.13"
              strokeWidth={0.6}
              vectorEffect="non-scaling-stroke"
            />

            {/* Land, far rings first: the depth sort is what makes overlapping coastlines read as
                surfaces rather than as one flat sticker. */}
            <g stroke="#0d4b45" strokeOpacity="0.16" strokeWidth="0.6">
              {land.map((ring, index) => (
                <path
                  key={index}
                  d={ring.path}
                  fill={`url(#${gradientId}-land)`}
                  fillOpacity={0.62 + 0.38 * Math.min(1, ring.depth * 1.3)}
                />
              ))}
            </g>

            {arc && (
              <g filter={`url(#${gradientId}-glow)`}>
                <path
                  d={arc.groundPath}
                  fill="none"
                  stroke="#ffffff"
                  strokeOpacity="0.35"
                  strokeWidth="1"
                  strokeDasharray="3 4"
                />
                <path
                  d={arc.path}
                  fill="none"
                  stroke="#ffffff"
                  strokeOpacity="0.85"
                  strokeWidth="7"
                  strokeLinecap="round"
                />
                <path
                  d={arc.path}
                  fill="none"
                  stroke={`url(#${gradientId}-arc)`}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray="10 6"
                  opacity={0.35 + 0.65 * progress}
                />
              </g>
            )}

            {arc?.originVisible && (
              <Marker
                at={screen(arc.origin, camera)}
                tone="#0f8a78"
                label={originLabel}
                align="start"
                ring
              />
            )}
            {arc?.destinationVisible && (
              <Marker
                at={screen(arc.destination, camera)}
                tone="#c2740b"
                label={destinationLabel}
                align="end"
                ring
              />
            )}

            {plane && <Plane at={plane.at} angle={plane.angle} />}
          </g>

          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill={`url(#${gradientId}-shade)`}
            pointerEvents="none"
          />
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="#eafaf7"
            strokeOpacity="0.5"
            strokeWidth="1"
            pointerEvents="none"
          />
        </svg>

        {controls && !reduced && (
          <div className="absolute bottom-0 left-0 flex items-center gap-1.5">
            <GlobeButton
              onClick={() => setSpinning((value) => !value)}
              label={spinning ? "توقف چرخش" : "چرخش خودکار"}
              testId="globe-spin"
            >
              {spinning ? <PauseIcon /> : <PlayIcon />}
            </GlobeButton>
            <GlobeButton
              onClick={reset}
              label="بازگشت به نمای مسیر"
              testId="globe-reset"
            >
              <ResetIcon />
            </GlobeButton>
          </div>
        )}
      </div>

      {caption && (
        <figcaption className="mt-3 space-y-1.5 text-center">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

// ————— helpers —————

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Midpoint longitude that survives the antimeridian (Alaska → Japan must not go via Africa). */
function midpointLon(a: number, b: number): number {
  let delta = b - a;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  let mid = a + delta / 2;
  if (mid > 180) mid -= 360;
  if (mid < -180) mid += 360;
  return mid;
}

function screen(v: Vec3, camera: Camera): [number, number] {
  return [camera.cx + camera.radius * v.x, camera.cy - camera.radius * v.z];
}

interface ProjectedLand {
  path: string;
  depth: number;
}

/**
 * Project every ring for one frame and sort by depth.
 *
 * `projectRing` returns null for rings that have nothing on the near side, which is the usual case
 * for roughly half the planet — so this is one pass over the vertices plus a sort over ~300 rings.
 */
function projectLand(rings: Ring[], camera: Camera): ProjectedLand[] {
  const out: ProjectedLand[] = [];
  for (const ring of rings) {
    const projected = projectRing(ring, camera);
    if (projected) out.push({ path: projected.path, depth: projected.depth });
  }
  // Far first, near last: the near face of a continent paints over the far one.
  out.sort((a, b) => a.depth - b.depth);
  return out;
}

/** Graticule: 20° meridians and parallels, clipped by the horizon like everything else. */
function projectGraticule(camera: Camera): string {
  let path = "";
  const push = (run: string[]) => {
    if (run.length > 1) path += `M${run.join("L")}`;
  };
  const project = (lon: number, lat: number): [number, number] | null => {
    const v = toVec(lon, lat);
    const y = camera.m[3]! * v.x + camera.m[4]! * v.y + camera.m[5]! * v.z;
    if (y <= 0) return null;
    const x = camera.m[0]! * v.x + camera.m[1]! * v.y + camera.m[2]! * v.z;
    const z = camera.m[6]! * v.x + camera.m[7]! * v.y + camera.m[8]! * v.z;
    return [camera.cx + camera.radius * x, camera.cy - camera.radius * z];
  };

  for (let lat = -60; lat <= 60; lat += 20) {
    let run: string[] = [];
    for (let lon = -180; lon <= 180; lon += 3) {
      const point = project(lon, lat);
      if (!point) {
        push(run);
        run = [];
        continue;
      }
      run.push(`${point[0].toFixed(1)} ${point[1].toFixed(1)}`);
    }
    push(run);
  }
  for (let lon = -180; lon < 180; lon += 20) {
    let run: string[] = [];
    for (let lat = -88; lat <= 88; lat += 3) {
      const point = project(lon, lat);
      if (!point) {
        push(run);
        run = [];
        continue;
      }
      run.push(`${point[0].toFixed(1)} ${point[1].toFixed(1)}`);
    }
    push(run);
  }
  return path;
}

function Marker({
  at,
  tone,
  label,
  align,
  ring = false,
}: {
  at: [number, number];
  tone: string;
  label: string;
  align: "start" | "end";
  ring?: boolean;
}) {
  const [x, y] = at;
  const dx = align === "start" ? 10 : -10;
  return (
    <g>
      {ring && <circle cx={x} cy={y} r="12" fill={tone} fillOpacity="0.14" />}
      <circle
        cx={x}
        cy={y}
        r="4.6"
        fill={tone}
        stroke="#ffffff"
        strokeWidth="1.8"
      />
      {label && (
        <text
          x={x + dx}
          y={y + 3.6}
          textAnchor={align === "start" ? "start" : "end"}
          fontSize="9.5"
          fontWeight="700"
          fill={align === "start" ? "#0a4d47" : "#8a5109"}
          stroke="#ffffff"
          strokeWidth="2.8"
          paintOrder="stroke"
          strokeLinejoin="round"
          style={{ fontFamily: "var(--font-sans), system-ui, sans-serif" }}
        >
          {label}
        </text>
      )}
    </g>
  );
}

function Plane({ at, angle }: { at: [number, number]; angle: number }) {
  return (
    <g
      transform={`translate(${at[0]} ${at[1]}) rotate(${angle})`}
      style={{ pointerEvents: "none" }}
    >
      <circle r="9" fill="#0f8a78" fillOpacity="0.14" />
      <path
        d="M8 0L-4.4 4.8L-1.8 0L-4.4 -4.8Z"
        fill="#0b1424"
        stroke="#ffffff"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </g>
  );
}

function GlobeButton({
  onClick,
  label,
  testId,
  children,
}: {
  onClick: () => void;
  label: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid={testId}
      className="grid size-7 place-items-center rounded-full border border-ink-200/80 bg-white/85 text-ink-500 shadow-sm backdrop-blur transition-colors hover:border-teal-400 hover:text-teal-700"
    >
      {children}
    </button>
  );
}

function PauseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5"
      aria-hidden="true"
      fill="currentColor"
    >
      <rect x="4" y="3" width="3" height="10" rx="1" />
      <rect x="9" y="3" width="3" height="10" rx="1" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M5 3.2v9.6a.6.6 0 0 0 .92.5l7.2-4.8a.6.6 0 0 0 0-1L5.92 2.7a.6.6 0 0 0-.92.5Z" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M3 8a5 5 0 1 0 1.7-3.8" />
      <path d="M3 2.8V5.4h2.6" />
    </svg>
  );
}

/** Tiny wrapper so the ids are unique even with several globes on a page. */
function useId(prefix: string): string {
  return useMemo(
    () => `${prefix}-${Math.random().toString(36).slice(2, 8)}`,
    [prefix],
  );
}
