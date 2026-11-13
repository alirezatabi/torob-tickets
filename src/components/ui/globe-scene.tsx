"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

  const [yaw, setYaw] = useState(planet ? -32 : centre[0]);
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
  const phase = useRef(Math.random() * Math.PI * 2);
  const frame = useRef<number | null>(null);
  const startYaw = useRef(planet ? -32 : centre[0]);
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
  const land = useMemo(() => projectLand(rings, camera), [rings, camera]);
  const graticule = useMemo(() => projectGraticule(camera), [camera]);
  const biomes = useMemo(() => projectBiomes(camera), [camera]);
  const relief = useMemo(() => projectRelief(camera), [camera]);
  const dottedLand = useMemo(
    () => (planet ? projectDottedLand(camera) : { land: "", lights: "" }),
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

  const gradientId = useId("globe");
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

          {/* One quiet orbital trace adds scale without crowding the globe. */}
          {planet ? (
            <ellipse
              cx={cx}
              cy={cy}
              rx={radius * 1.2}
              ry={radius * 0.43}
              transform={`rotate(-24 ${cx} ${cy})`}
              fill="none"
              stroke="#318fd5"
              strokeOpacity="0.22"
              strokeWidth="1"
              strokeDasharray="2 8"
            />
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
              strokeOpacity={planet ? "0.22" : "0.13"}
              strokeWidth={0.6}
              vectorEffect="non-scaling-stroke"
            />

            {planet ? (
              <>
                <path
                  d={dottedLand.land}
                  fill="none"
                  stroke="#55baff"
                  strokeWidth="1.45"
                  strokeLinecap="round"
                  strokeOpacity="0.82"
                />
                <path
                  d={dottedLand.lights}
                  fill="none"
                  stroke="#f1bd63"
                  strokeWidth="1.65"
                  strokeLinecap="round"
                  strokeOpacity="0.8"
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
            {planet && network.map((link, index) => {
              const color = link.accent === "gold" ? "#efbd63" : "#43baff";
              return (
                <g key={`network-${index}`} fill="none" stroke={color} strokeLinecap="round">
                  <path d={link.path} strokeOpacity="0.12" strokeWidth="4" />
                  <path d={link.path} strokeOpacity="0.76" strokeWidth="1.25" strokeDasharray="3 7" />
                </g>
              );
            })}
            {planet && serviceMarkers.map((marker, index) => (
              <NetworkNode key={`service-${index}`} marker={marker} glowId={`${gradientId}-glow`} />
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
              stroke="#168ff0"
              strokeOpacity="0.34"
              strokeWidth="7"
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

type ServiceMarkerData = { x: number; y: number; accent: "cyan" | "gold" };

const SERVICE_LOCATIONS: { point: Point; accent: "cyan" | "gold" }[] = [
  { point: [-0.12, 51.5], accent: "cyan" },
  { point: [-74, 40.7], accent: "cyan" },
  { point: [-46.6, -23.5], accent: "gold" },
  { point: [8.68, 50.1], accent: "gold" },
  { point: [55.3, 25.2], accent: "cyan" },
  { point: [103.8, 1.35], accent: "gold" },
  { point: [139.7, 35.7], accent: "cyan" },
  { point: [151.2, -33.8], accent: "gold" },
];

const CITY_LIGHT_CENTERS: Point[] = [
  [-74, 40],
  [-122, 37],
  [-47, -23],
  [8, 50],
  [30, 30],
  [55, 25],
  [78, 23],
  [105, 30],
  [139, 36],
];

function projectDottedLand(camera: Camera): { land: string; lights: string } {
  const points = globeDots as [number, number][];
  let land = "";
  let lights = "";
  for (const [lon, lat] of points) {
    const point = rotate(camera.m, toVec(lon, lat));
    if (point.y >= -0.025) continue;
    const x = (camera.cx + camera.radius * point.x).toFixed(1);
    const y = (camera.cy - camera.radius * point.z).toFixed(1);
    const cityLit = CITY_LIGHT_CENTERS.some(([cityLon, cityLat]) => {
      const lonDistance = Math.abs(((lon - cityLon + 540) % 360) - 180);
      return lonDistance < 7.5 && Math.abs(lat - cityLat) < 6;
    });
    if (cityLit) lights += `M${x} ${y}h0.01`;
    else land += `M${x} ${y}h0.01`;
  }
  return { land, lights };
}

function projectServiceMarkers(camera: Camera): ServiceMarkerData[] {
  return SERVICE_LOCATIONS.flatMap(({ point: [lon, lat], accent }) => {
    const surface = rotate(camera.m, toVec(lon, lat));
    if (surface.y >= -0.08) return [];
    return [{
      x: camera.cx + camera.radius * surface.x,
      y: camera.cy - camera.radius * surface.z,
      accent,
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


const NETWORK_ROUTES: [number, number][] = [
  [3, 0], [3, 1], [3, 2], [3, 4], [3, 5], [3, 6], [3, 7],
  [1, 0], [1, 2], [0, 2], [4, 5], [5, 6], [5, 7], [6, 7],
];

function projectNetwork(camera: Camera): { path: string; accent: "gold" | "cyan" }[] {
  return NETWORK_ROUTES.flatMap(([fromIndex, toIndex], index) => {
    const origin = NETWORK_LOCATIONS[fromIndex]!;
    const destination = NETWORK_LOCATIONS[toIndex]!;
    const km = distanceKm(origin, destination);
    const angle = Math.min((km / 6371) * (180 / Math.PI), 175);
    const arc = flightArc(origin, destination, angle, camera, 56);
    const accent = index % 4 === 0 ? "gold" : "cyan";
    return arc.path ? [{ path: arc.path, accent }] : [];
  });
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
  const color = marker.accent === "gold" ? "#f1bd63" : "#62c6ff";
  return (
    <g aria-hidden="true">
      <circle cx={marker.x} cy={marker.y} r="24" fill="none" stroke={color} strokeOpacity="0.11" strokeWidth="1" />
      <circle cx={marker.x} cy={marker.y} r="12" fill="none" stroke={color} strokeOpacity="0.38" strokeWidth="0.9" />
      <circle cx={marker.x} cy={marker.y} r="5" fill={color} fillOpacity="0.2" />
      <circle cx={marker.x} cy={marker.y} r="2.6" fill={color} filter={`url(#${glowId})`} />
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

/** Tiny wrapper so the ids are unique even with several globes on a page. */
function useId(prefix: string): string {
  return useMemo(
    () => `${prefix}-${Math.random().toString(36).slice(2, 8)}`,
    [prefix],
  );
}
