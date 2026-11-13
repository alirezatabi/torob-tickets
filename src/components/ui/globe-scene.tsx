"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { distanceKm, type Point } from "@/lib/geo";
import globeDots from "@/lib/map/globe-dots.json";
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
  rotate,
  rotationMatrix,
  routeZoom,
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
 * horizon every frame. The look is an original hand-crafted SVG illustration, not a satellite photo.
 *
 * What makes it read as a designed, dimensional globe rather than a flat icon:
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

const SPACE_STARS = (() => {
  let seed = 0x51f15e;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  return Array.from({ length: 72 }, () => ({
    x: next(),
    y: next(),
    radius: 0.45 + next() * 0.8,
    opacity: 0.16 + next() * 0.34,
  }));
})();

const SATELLITES = [
  { x: 0.08, y: 0.2, angle: -28, scale: 1 },
  { x: 0.82, y: 0.105, angle: 24, scale: 1.12 },
  { x: 0.32, y: 0.055, angle: 8, scale: 0.8 },
] as const;

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

  /** Keep short domestic routes at globe scale; see routeZoom() and docs/REPORT-02 §۱۴. */
  const baseZoom = useMemo(() => (route ? routeZoom(km) : 1), [route, km]);

  const [yaw, setYaw] = useState(planet ? 18 : centre[0]);
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
  const zoomTarget = useRef(initialZoom);
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
  // Keep the render path deterministic; the idle sway starts at a neutral phase after hydration.
  const phase = useRef(0);
  const frame = useRef<number | null>(null);
  const startYaw = useRef(planet ? 18 : centre[0]);
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
    // A domestic-route globe stays nearly full-frame, so load enough boundary detail for the
    // small country shapes instead of magnifying the low-detail whole-world tier.
    const needed = Math.max(2, coastLevel(baseZoom)) as CoastLevel;
    zoomTarget.current = baseZoom;

    void loadCoast(needed).then((rings) => {
      if (cancelled || rings.length === 0) return;
      setLevel(needed);
      const startZoom = zoomTarget.current;
      setZoom(startZoom);

      // A visitor who asked for less motion gets the final, fully detailed frame — no zoom-in,
      // no flying plane, no idle sway.
      if (reduced || touched.current) {
        setProgress(1);
        return;
      }

      setProgress(0);
      zoomTarget.current = startZoom * 0.6;
      setZoom(zoomTarget.current);
      timers.push(
        window.setTimeout(() => {
          zoomTarget.current = startZoom;
          setZoom(startZoom);
        }, 80),
      );

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

  // When a visitor zooms past a detail threshold, fetch that coast tier before drawing it.
  useEffect(() => {
    const needed = coastLevel(zoom);
    if (needed <= level) return;
    let cancelled = false;
    void loadCoast(needed).then((rings) => {
      if (!cancelled && rings.length > 0) setLevel(needed);
    });
    return () => {
      cancelled = true;
    };
  }, [zoom, level]);

  const rings = COAST[level];
  // The hero uses point-projected land dots instead of horizon-clipped country polygons: the
  // latter can close across the polar limb and briefly paint ocean as land while the globe spins.
  const land = useMemo(() => (planet ? [] : projectLand(rings, camera)), [rings, camera, planet]);
  const graticule = useMemo(() => projectGraticule(camera), [camera]);
  const biomes = useMemo(() => (planet ? [] : projectBiomes(camera)), [camera, planet]);
  const relief = useMemo(() => projectRelief(camera), [camera]);
  const dottedLand = useMemo(
    () => (planet ? projectDottedLand(camera) : { land: "" }),
    [camera, planet],
  );
  const serviceMarkers = useMemo(
    () => (planet ? projectServiceMarkers(camera) : []),
    [camera, planet],
  );
  const network = useMemo(
    () => (planet ? projectNetwork(camera) : []),
    [camera, planet],
  );
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
      current.vx = -deltaYaw;
      current.vy = -deltaPitch;
      // The globe follows the hand: dragging right brings eastern longitudes into view.
      current.yaw -= deltaYaw;
      current.pitch = clamp(current.pitch + deltaPitch, -70, 70);
      setYaw(current.yaw);
      setPitch(current.pitch);
    },
    [radius],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const target = clamp(zoomTarget.current * factor, 1, 8);
      zoomTarget.current = target;
      touched.current = true;
      const needed = coastLevel(target);
      if (needed <= level) {
        setZoom(target);
        return;
      }
      // Hold the camera still until the corresponding coastline tier is ready. This avoids the
      // coarse-to-detailed pop when someone zooms quickly through a tier boundary.
      void loadCoast(needed).then((rings) => {
        if (rings.length === 0) return;
        setLevel((current) => (current > needed ? current : needed));
        setZoom(zoomTarget.current);
      });
    },
    [level],
  );

  const onWheel = useCallback(
    (event: React.WheelEvent<SVGSVGElement>) => {
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY * 0.0012));
    },
    [zoomBy],
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
    zoomTarget.current = planet ? 1 : baseZoom;
    setZoom(zoomTarget.current);
  }, [baseZoom, planet]);

  const gradientId = `globe-${useId().replace(/:/g, "")}`;
  const clipId = `${gradientId}-clip`;
  const landClipId = `${gradientId}-land-clip`;

  return (
    <figure
      className={className}
      data-globe={planet ? "planet" : "live"}
      data-testid={planet ? undefined : "route-globe"}
      data-zoom={zoom.toFixed(2)}
    >
      <div
        className="relative mx-auto aspect-square w-full"
        style={{ maxWidth: size }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-[2%] rounded-full bg-gradient-to-tr from-cyan-300/30 via-blue-500/10 to-orange-400/30 blur-2xl"
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
          onWheel={onWheel}
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
              <stop offset="0%" stopColor="#9ce8ff" />
              <stop offset="28%" stopColor="#318fbd" />
              <stop offset="66%" stopColor="#155c91" />
              <stop offset="100%" stopColor="#102145" />
            </radialGradient>
            <radialGradient
              id={`${gradientId}-planet-ocean`}
              cx="34%"
              cy="27%"
              r="78%"
            >
              <stop offset="0%" stopColor="#14345a" />
              <stop offset="48%" stopColor="#081a31" />
              <stop offset="82%" stopColor="#041020" />
              <stop offset="100%" stopColor="#020711" />
            </radialGradient>
            <linearGradient id={`${gradientId}-planet-night`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="22%" stopColor="#020711" stopOpacity="0" />
              <stop offset="100%" stopColor="#020711" stopOpacity="0.58" />
            </linearGradient>
            <radialGradient id={`${gradientId}-land`} cx="30%" cy="20%" r="95%">
              <stop offset="0%" stopColor="#f9e4b7" />
              <stop offset="42%" stopColor="#bad9b9" />
              <stop offset="78%" stopColor="#70aaa0" />
              <stop offset="100%" stopColor="#416f81" />
            </radialGradient>
            <pattern
              id={`${gradientId}-handmade`}
              width="24"
              height="20"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(-12)"
            >
              <path
                d="M-4 5C1 1 6 1 11 5S21 9 28 4M-4 14c5-4 10-4 15 0s10 4 17-1"
                fill="none"
                stroke="#fff5d7"
                strokeOpacity="0.17"
                strokeWidth="1"
              />
              <circle cx="6" cy="10" r="1.1" fill="#f7c27d" fillOpacity="0.3" />
              <circle
                cx="20"
                cy="17"
                r="0.8"
                fill="#215f64"
                fillOpacity="0.22"
              />
            </pattern>
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
              <stop offset="0%" stopColor="#ffcf83" />
              <stop offset="48%" stopColor="#ff875c" />
              <stop offset="100%" stopColor="#62d5e9" />
            </linearGradient>
            <clipPath id={clipId}>
              <circle cx={cx} cy={cy} r={radius} />
            </clipPath>
            <clipPath id={landClipId}>
              <g clipPath={`url(#${clipId})`}>
                {land.map((ring, index) => (
                  <path
                    key={index}
                    d={ring.path}
                    fill="#fff"
                    clipRule="evenodd"
                  />
                ))}
              </g>
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

          {planet && (
            <g aria-hidden="true">
              {SPACE_STARS.filter((star) => {
                const dx = star.x * size - cx;
                const dy = star.y * size - cy;
                return dx * dx + dy * dy > (radius * 1.045) ** 2;
              }).map((star, index) => (
                <circle
                  key={`space-star-${index}`}
                  cx={star.x * size}
                  cy={star.y * size}
                  r={star.radius}
                  fill={index % 9 === 0 ? "#bdeeff" : "#8fb9d8"}
                  opacity={star.opacity}
                />
              ))}
            </g>
          )}

          {/* Fine orbital paths echo the satellite network while keeping the globe illustrative. */}
          {planet ? (
            <>
              <ellipse
                cx={cx}
                cy={cy}
                rx={radius * 1.2}
                ry={radius * 0.43}
                transform={`rotate(-24 ${cx} ${cy})`}
                fill="none"
                stroke="#318fd5"
                strokeOpacity="0.3"
                strokeWidth="1"
                strokeDasharray="2 7"
              />
              <ellipse
                cx={cx}
                cy={cy}
                rx={radius * 1.31}
                ry={radius * 0.58}
                transform={`rotate(18 ${cx} ${cy})`}
                fill="none"
                stroke="#57baff"
                strokeOpacity="0.13"
                strokeWidth="0.8"
                strokeDasharray="1 10"
              />
            </>
          ) : (
            <ellipse
              cx={cx}
              cy={cy}
              rx={radius * 1.16}
              ry={radius * 0.36}
              transform={`rotate(-22 ${cx} ${cy})`}
              fill="none"
              stroke="#ffad66"
              strokeOpacity="0.48"
              strokeWidth="1.25"
              strokeDasharray="2 8"
            />
          )}
          {planet && SATELLITES.map((satellite, index) => (
            <g
              key={`satellite-${index}`}
              aria-hidden="true"
              transform={`translate(${size * satellite.x} ${size * satellite.y}) rotate(${satellite.angle}) scale(${satellite.scale})`}
              opacity="0.82"
            >
              <path d="M-3 0H-14M3 0H14" stroke="#a9d8ee" strokeWidth="1.2" />
              <rect x="-14" y="-4.5" width="8" height="9" rx="0.7" fill="#155b89" stroke="#8bd6ff" strokeWidth="0.8" />
              <path d="M-12-2.5h4M-12 0h4M-12 2.5h4" stroke="#5bb9eb" strokeWidth="0.45" />
              <rect x="6" y="-4.5" width="8" height="9" rx="0.7" fill="#155b89" stroke="#8bd6ff" strokeWidth="0.8" />
              <path d="M8-2.5h4M8 0h4M8 2.5h4" stroke="#5bb9eb" strokeWidth="0.45" />
              <rect x="-3.2" y="-3.2" width="6.4" height="6.4" rx="1" fill="#d8f5ff" stroke="#4fbaff" strokeWidth="0.8" />
              <circle cx="0" cy="0" r="1" fill="#9ce8ff" />
              <path d="M0-3.2V-7" stroke="#9ce8ff" strokeWidth="0.7" />
            </g>
          ))}
          {/* Stylized atmosphere, rather than a photographic glow. */}
          <circle
            cx={cx}
            cy={cy}
            r={radius * 1.04}
            fill={planet ? "#138cf1" : "#ff9c55"}
            fillOpacity={planet ? "0.075" : "0.2"}
          />
          <circle
            cx={cx}
            cy={cy}
            r={radius * 1.018}
            fill={planet ? "#35b9ff" : "#55bdff"}
            fillOpacity={planet ? "0.09" : "0.19"}
          />
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill={planet ? `url(#${gradientId}-planet-ocean)` : `url(#${gradientId}-ocean)`}
          />

          <g clipPath={`url(#${clipId})`}>
            <path
              d={graticule}
              fill="none"
              stroke={planet ? "#3978aa" : "#eafaf7"}
              strokeOpacity={planet ? "0.14" : "0.13"}
              strokeWidth={0.6}
              vectorEffect="non-scaling-stroke"
            />

            {planet ? (
              <>
                {/* Land is a set of geodetic samples, so horizon rotation cannot close a polygon over the ocean. */}
                <g>
                  {relief.map((ridge, index) => (
                    <path
                      key={`planet-relief-${index}`}
                      d={ridge}
                      fill="none"
                      stroke="#8cb8c7"
                      strokeOpacity="0.2"
                      strokeWidth="0.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                </g>
                <path
                  d={dottedLand.land}
                  data-globe-land-dots="true"
                  fill="none"
                  stroke="#91ddff"
                  strokeWidth="1.45"
                  strokeLinecap="round"
                  strokeOpacity="0.9"
                />
              </>
            ) : (
              <>
                {/* Land, far rings first: the depth sort is what makes overlapping coastlines read as
                    surfaces rather than as one flat sticker. */}
                <g>
                  {land.map((ring, index) => (
                    <path
                      key={index}
                      d={ring.path}
                      fill={`url(#${gradientId}-land)`}
                      fillOpacity={0.68 + 0.32 * Math.min(1, ring.depth * 1.3)}
                      stroke="#31585e"
                      strokeOpacity="0.48"
                      strokeWidth="0.62"
                    />
                  ))}
                </g>
                <g clipPath={`url(#${landClipId})`}>
                  <rect x="0" y="0" width={size} height={size} fill={`url(#${gradientId}-handmade)`} opacity="0.78" />
                  {biomes.map((zone, index) => (
                    <path key={`biome-${index}`} d={zone.path} fill={zone.fill} fillOpacity={zone.opacity} />
                  ))}
                  {relief.map((ridge, index) => (
                    <path key={`ridge-${index}`} d={ridge} fill="none" stroke="#795e46" strokeOpacity="0.68" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" />
                  ))}
                </g>
              </>
            )}
            {planet && network.map((link, index) => (
              <g key={`network-${index}`} data-network-flight="true" fill="none" stroke="#43baff" strokeLinecap="round">
                <path
                  d={link.path}
                  strokeOpacity="0.18"
                  strokeWidth="4"
                  filter={`url(#${gradientId}-glow)`}
                />
                <path d={link.path} strokeOpacity="0.8" strokeWidth="1.4" strokeDasharray="2 5" />
              </g>
            ))}
            {planet && serviceMarkers.map((marker, index) => (
              <NetworkNode key={`service-${index}`} marker={marker} glowId={`${gradientId}-glow`} />
            ))}
            {planet && network.map((link, index) => (
              link.plane ? (
                <AirplaneMarker
                  key={`plane-${index}`}
                  at={link.plane.at}
                  angle={link.plane.angle}
                />
              ) : null
            ))}
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

          {planet && (
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              fill={`url(#${gradientId}-planet-night)`}
              pointerEvents="none"
            />
          )}
          {planet && (
            <circle
              cx={cx}
              cy={cy}
              r={radius * 1.004}
              fill="none"
              stroke="#38baff"
              strokeOpacity="0.52"
              strokeWidth="8"
              filter={`url(#${gradientId}-glow)`}
              pointerEvents="none"
            />
          )}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill={planet ? "#020711" : `url(#${gradientId}-shade)`}
            fillOpacity={planet ? "0.12" : undefined}
            pointerEvents="none"
          />
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={planet ? "#54baff" : "#eafaf7"}
            strokeOpacity={planet ? "0.48" : "0.5"}
            strokeWidth={planet ? "1.4" : "1"}
            pointerEvents="none"
          />
          {planet && network.map((link, index) => link.outerPath ? (
            <g key={`network-flight-off-limb-${index}`} data-flight-extension="true" fill="none" stroke="#43baff" strokeLinecap="round">
              <path d={link.outerPath} strokeOpacity="0.25" strokeWidth="4" filter={`url(#${gradientId}-glow)`} />
              <path d={link.outerPath} strokeOpacity="0.92" strokeWidth="1.4" strokeDasharray="2 5" />
            </g>
          ) : null)}
        </svg>

        {controls && (
          <div className="absolute bottom-0 left-0 flex items-center gap-1.5">
            <GlobeButton
              onClick={() => zoomBy(1.35)}
              label="بزرگ‌نمایی کره"
              testId="globe-zoom-in"
            >
              <ZoomInIcon />
            </GlobeButton>
            <GlobeButton
              onClick={() => zoomBy(1 / 1.35)}
              label="کوچک‌نمایی کره"
              testId="globe-zoom-out"
            >
              <ZoomOutIcon />
            </GlobeButton>
            {!reduced && (
              <>
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
              </>
            )}
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

type BiomeStyle = "forest" | "desert" | "snow";
interface ProjectedBiome {
  path: string;
  fill: string;
  opacity: number;
}

const BIOME_REGIONS: { style: BiomeStyle; points: Point[] }[] = [
  {
    style: "desert",
    points: [
      [-18, 30],
      [34, 30],
      [39, 16],
      [-12, 13],
    ],
  }, // Sahara
  {
    style: "desert",
    points: [
      [37, 31],
      [58, 29],
      [57, 15],
      [42, 12],
    ],
  }, // Arabia
  {
    style: "desert",
    points: [
      [78, 48],
      [112, 49],
      [116, 39],
      [87, 35],
    ],
  }, // Gobi
  {
    style: "desert",
    points: [
      [116, -18],
      [143, -17],
      [142, -34],
      [121, -35],
    ],
  }, // Outback
  {
    style: "forest",
    points: [
      [-78, 8],
      [-48, 10],
      [-43, -8],
      [-69, -16],
    ],
  }, // Amazon
  {
    style: "forest",
    points: [
      [10, 6],
      [32, 5],
      [30, -9],
      [14, -8],
    ],
  }, // Congo
  {
    style: "forest",
    points: [
      [96, 16],
      [124, 20],
      [132, -5],
      [108, -11],
    ],
  }, // Maritime SE Asia
  {
    style: "snow",
    points: [
      [-53, 83],
      [-17, 80],
      [-22, 60],
      [-50, 59],
    ],
  }, // Greenland
];

const MOUNTAIN_RANGES: Point[][] = [
  [
    [-130, 60],
    [-120, 53],
    [-113, 46],
    [-110, 39],
    [-106, 32],
  ], // Rockies
  [
    [-78, 9],
    [-76, -2],
    [-74, -16],
    [-72, -31],
    [-70, -47],
    [-74, -55],
  ], // Andes
  [
    [-10, 33],
    [0, 35],
    [10, 33],
  ], // Atlas
  [
    [-5, 45],
    [5, 46],
    [15, 47],
    [25, 45],
  ], // Alps
  [
    [35, 39],
    [45, 37],
    [54, 35],
    [64, 35],
    [73, 34],
    [82, 30],
    [92, 28],
    [103, 30],
  ], // Zagros–Himalaya
  [
    [-72, 61],
    [-50, 66],
    [-35, 70],
  ], // Greenland ice ridge
];

type ServiceMarkerData = { x: number; y: number };

const SERVICE_LOCATIONS: Point[] = [
  [-118.24, 34.05],
  [-0.12, 51.5],
  [-74, 40.7],
  [-46.6, -23.5],
  [2.35, 48.86],
  [8.68, 50.1],
  [28.98, 41.01],
  [55.3, 25.2],
  [72.88, 19.08],
  [31.02, -29.86],
  [103.8, 1.35],
  [114.17, 22.3],
  [139.7, 35.7],
  [151.2, -33.8],
];

function projectDottedLand(camera: Camera): { land: string } {
  let land = "";
  for (const [lon, lat] of globeDots as [number, number][]) {
    const point = rotate(camera.m, toVec(lon, lat));
    if (point.y >= -0.025) continue;
    const x = (camera.cx + camera.radius * point.x).toFixed(1);
    const y = (camera.cy - camera.radius * point.z).toFixed(1);
    land += `M${x} ${y}h0.01`;
  }
  return { land };
}

function projectServiceMarkers(camera: Camera): ServiceMarkerData[] {
  return SERVICE_LOCATIONS.flatMap(([lon, lat]) => {
    const surface = rotate(camera.m, toVec(lon, lat));
    if (surface.y >= -0.08) return [];
    return [{
      x: Number((camera.cx + camera.radius * surface.x).toFixed(1)),
      y: Number((camera.cy - camera.radius * surface.z).toFixed(1)),
    }];
  });
}

const NETWORK_LOCATIONS: Point[] = [
  [-0.12, 51.5], // London
  [-74, 40.7], // New York
  [-46.6, -23.5], // Sao Paulo
  [8.68, 50.1], // Frankfurt
  [55.3, 25.2], // Dubai
  [103.8, 1.35], // Singapore
  [139.7, 35.7], // Tokyo
  [151.2, -33.8], // Sydney
  [-118.24, 34.05], // Los Angeles
  [-79.38, 43.65], // Toronto
  [31.02, -29.86], // Cape Town
  [72.88, 19.08], // Mumbai
  [114.17, 22.3], // Hong Kong
  [2.35, 48.86], // Paris
  [28.98, 41.01], // Istanbul
  [126.98, 37.56], // Seoul
];

function projectBiomes(camera: Camera): ProjectedBiome[] {
  const colors: Record<BiomeStyle, { fill: string; opacity: number }> = {
    forest: { fill: "#236f5e", opacity: 0.42 },
    desert: { fill: "#e9a95b", opacity: 0.46 },
    snow: { fill: "#f4f8ed", opacity: 0.8 },
  };
  return BIOME_REGIONS.flatMap(({ style, points }) => {
    const coordinates = new Float64Array(points.length * 2);
    points.forEach(([lon, lat], index) => {
      coordinates[index * 2] = lon;
      coordinates[index * 2 + 1] = lat;
    });
    const projected = projectRing(coordinates, camera);
    return projected ? [{ path: projected.path, ...colors[style] }] : [];
  });
}

function projectRelief(camera: Camera): string[] {
  return MOUNTAIN_RANGES.flatMap((range) => {
    const paths: string[] = [];
    let run: string[] = [];
    const flush = () => {
      if (run.length > 1) paths.push(`M${run.join("L")}`);
      run = [];
    };
    for (const [lon, lat] of range) {
      const point = rotate(camera.m, toVec(lon, lat));
      if (point.y >= 0) {
        flush();
        continue;
      }
      run.push(
        `${(camera.cx + camera.radius * point.x).toFixed(1)} ${(camera.cy - camera.radius * point.z).toFixed(1)}`,
      );
    }
    flush();
    return paths;
  });
}


const NETWORK_ROUTES: { from: number; to: number }[] = [
  { from: 1, to: 0 }, // New York–London
  { from: 0, to: 13 }, // London–Paris
  { from: 0, to: 10 }, // London–Cape Town
  { from: 1, to: 9 }, // New York–Toronto
  { from: 1, to: 8 }, // New York–Los Angeles
  { from: 1, to: 2 }, // New York–São Paulo
  { from: 2, to: 10 }, // São Paulo–Cape Town
  { from: 3, to: 13 }, // Frankfurt–Paris
  { from: 3, to: 4 }, // Frankfurt–Dubai
  { from: 3, to: 14 }, // Frankfurt–Istanbul
  { from: 3, to: 11 }, // Frankfurt–Mumbai
  { from: 4, to: 11 }, // Dubai–Mumbai
  { from: 4, to: 5 }, // Dubai–Singapore
  { from: 5, to: 12 }, // Singapore–Hong Kong
  { from: 5, to: 7 }, // Singapore–Sydney
  { from: 12, to: 6 }, // Hong Kong–Tokyo
  { from: 6, to: 15 }, // Tokyo–Seoul
  { from: 6, to: 7 }, // Tokyo–Sydney
  { from: 8, to: 6 }, // Los Angeles–Tokyo
  { from: 9, to: 3 }, // Toronto–Frankfurt
  { from: 10, to: 4 }, // Cape Town–Dubai
];

function projectNetwork(
  camera: Camera,
): { path: string; outerPath?: string; plane?: { at: [number, number]; angle: number } }[] {
  return NETWORK_ROUTES.flatMap(({ from, to }, routeIndex) => {
    const origin = NETWORK_LOCATIONS[from]!;
    const destination = NETWORK_LOCATIONS[to]!;
    const km = distanceKm(origin, destination);
    const angle = Math.min((km / 6371) * (180 / Math.PI), 175);
    const arc = flightArc(origin, destination, angle, camera, 96);
    // Elevated, all-cyan lanes. The smooth lift is zero at real city endpoints and peaks mid-flight.
    const maxLift = Math.min(0.18, 0.06 + (angle / 180) * 0.11 + (routeIndex % 3) * 0.006);
    const liftAt = (t: number) => maxLift * Math.sin(Math.PI * t);
    let path = "";
    let run: string[] = [];
    let visiblePoints: [number, number][] = [];
    let outerPath = "";
    const flush = () => {
      if (run.length > 1) path += `M${run.join("L")}`;
      if (visiblePoints.length > 1) outerPath += projectFlightLimb(visiblePoints, camera);
      run = [];
      visiblePoints = [];
    };
    for (const point of arc.points) {
      const lift = liftAt(point.t);
      const x = point.ground.x * (1 + lift);
      const y = point.ground.y * (1 + lift);
      const z = point.ground.z * (1 + lift);
      if (y >= 0) {
        flush();
        continue;
      }
      const screenX = camera.cx + camera.radius * x;
      const screenY = camera.cy - camera.radius * z;
      visiblePoints.push([screenX, screenY]);
      run.push(`${Math.round(screenX)} ${Math.round(screenY)}`);
    }
    flush();

    let plane: { at: [number, number]; angle: number } | undefined;
    if (routeIndex % 4 === 0) {
      const pointIndex = Math.round(arc.points.length * 0.44);
      const previousPoint = arc.points[Math.max(0, pointIndex - 1)]!;
      const current = arc.points[pointIndex]!;
      const next = arc.points[Math.min(arc.points.length - 1, pointIndex + 1)]!;
      if (current.ground.y * (1 + liftAt(current.t)) < -0.08) {
        const screenPoint = (point: (typeof arc.points)[number]): [number, number] => {
          const lift = liftAt(point.t);
          return [
            camera.cx + camera.radius * point.ground.x * (1 + lift),
            camera.cy - camera.radius * point.ground.z * (1 + lift),
          ];
        };
        const [x0, y0] = screenPoint(previousPoint);
        const [x, y] = screenPoint(current);
        const [x1, y1] = screenPoint(next);
        plane = {
          at: [Math.round(x), Math.round(y)],
          angle: Math.round(((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI) * 10) / 10,
        };
      }
    }
    return path ? [{ path, ...(outerPath ? { outerPath } : {}), ...(plane ? { plane } : {}) }] : [];
  });
}

/** Keep only the first short shell outside the disc, following the real arc tangent. */
function projectFlightLimb(points: [number, number][], camera: Camera): string {
  const innerRadius = camera.radius;
  const outerRadius = innerRadius * 1.085;
  const innerSquared = innerRadius * innerRadius;
  const outerSquared = outerRadius * outerRadius;
  let path = "";
  let run: string[] = [];
  const flush = () => {
    if (run.length > 1) path += `M${run.join("L")}`;
    run = [];
  };
  const formatPoint = (point: [number, number]) =>
    `${Math.round(point[0])} ${Math.round(point[1])}`;

  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const cuts = [0, 1, ...circleIntersections(from, to, camera, innerRadius), ...circleIntersections(from, to, camera, outerRadius)]
      .sort((a, b) => a - b)
      .filter((value, cutIndex, values) => cutIndex === 0 || value - values[cutIndex - 1]! > 1e-8);
    let keptSegment = false;
    for (let cutIndex = 1; cutIndex < cuts.length; cutIndex += 1) {
      const t0 = cuts[cutIndex - 1]!;
      const t1 = cuts[cutIndex]!;
      const middle = (t0 + t1) / 2;
      const mx = from[0] + (to[0] - from[0]) * middle - camera.cx;
      const my = from[1] + (to[1] - from[1]) * middle - camera.cy;
      const radiusSquared = mx * mx + my * my;
      if (radiusSquared < innerSquared || radiusSquared > outerSquared) continue;
      const start: [number, number] = [from[0] + (to[0] - from[0]) * t0, from[1] + (to[1] - from[1]) * t0];
      const end: [number, number] = [from[0] + (to[0] - from[0]) * t1, from[1] + (to[1] - from[1]) * t1];
      const startText = formatPoint(start);
      const endText = formatPoint(end);
      if (run.length === 0) run.push(startText, endText);
      else if (run[run.length - 1] === startText) run.push(endText);
      else {
        flush();
        run.push(startText, endText);
      }
      keptSegment = true;
    }
    if (!keptSegment) flush();
  }
  flush();
  return path;
}

function circleIntersections(
  from: [number, number],
  to: [number, number],
  camera: Camera,
  radius: number,
): number[] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const ox = from[0] - camera.cx;
  const oy = from[1] - camera.cy;
  const a = dx * dx + dy * dy;
  if (a === 0) return [];
  const b = 2 * (ox * dx + oy * dy);
  const c = ox * ox + oy * oy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant <= 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter((t) => t > 0 && t < 1);
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
    if (y >= 0) return null;
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

function NetworkNode({ marker, glowId }: { marker: ServiceMarkerData; glowId: string }) {
  const color = "#62c6ff";
  return (
    <g data-service-marker="true" aria-hidden="true">
      <circle cx={marker.x} cy={marker.y} r="30" fill="none" stroke={color} strokeOpacity="0.12" strokeWidth="1" />
      <circle cx={marker.x} cy={marker.y} r="15" fill="none" stroke={color} strokeOpacity="0.42" strokeWidth="0.9" />
      <circle cx={marker.x} cy={marker.y} r="6" fill={color} fillOpacity="0.24" />
      <circle cx={marker.x} cy={marker.y} r="3" fill={color} filter={`url(#${glowId})`} />
    </g>
  );
}

function formatRotationAngle(angle: number): string {
  const rounded = Math.round(angle * 10) / 10;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(1);
}

function AirplaneMarker({
  at,
  angle,
}: {
  at: [number, number];
  angle: number;
}) {
  const color = "#62c6ff";
  return (
    <g
      data-airplane-marker="true"
      transform={`translate(${at[0]} ${at[1]}) rotate(${formatRotationAngle(angle + 90)})`}
      aria-hidden="true"
    >
      <circle r="12" fill={color} fillOpacity="0.18" />
      <path
        transform="translate(-11.5 -11.5)"
        d="M11.5 1.25c.8 0 1.3.6 1.3 1.5v4.6l7.4 4.3c.4.2.6.6.6 1v1.2l-8-2.2v6.7l2.8 1.8v1.4l-4.1-.5-4.1.5v-1.4l2.8-1.8v-6.7l-8 2.2v-1.2c0-.4.2-.8.6-1l7.4-4.3v-4.6c0-.9.5-1.5 1.3-1.5Z"
        fill="#eaf6ff"
        stroke={color}
        strokeWidth="0.85"
        strokeLinejoin="round"
      />
    </g>
  );
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
      transform={`translate(${at[0]} ${at[1]}) rotate(${formatRotationAngle(angle)})`}
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

function ZoomInIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12.2 12.2 17 17M8.5 6v5M6 8.5h5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ZoomOutIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12.2 12.2 17 17M6 8.5h5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
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
