"use client";

import { motion, useReducedMotion } from "motion/react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import landData from "@/lib/map/land-1deg.json";
import { bearing, distanceKm, type Point } from "@/lib/geo";
import {
  initialView,
  projectGraticule,
  projectLand,
  projectRoute,
  type LandRing,
} from "@/lib/globe-view";
import { cn } from "@/lib/cn";
import { toPersianDigits } from "@/lib/format";

/**
 * The ticket's planet — a 3D globe you can turn, not a picture of one.
 *
 * The server renders the same disc as a static frame (no JavaScript needed to see the route), and
 * this component takes over once it is hydrated: land, graticule, great-circle arc and both
 * airports are re-projected from the sphere on every frame, with the far side culled by the
 * orthographic horizon. Dragging turns the Earth; releasing lets it coast to a stop; the arc is
 * drawn progressively so the flight reads as a journey; and the whole thing falls back to a still
 * frame for visitors who ask for reduced motion (or when JavaScript never arrives).
 *
 * The maths lives in `lib/globe-view.ts` and is unit-tested; this file is interaction + paint.
 */

const LANDS = (landData as unknown as { rings: LandRing[] }).rings;
const SIZE = 340;
const DISC = 152;
const CX = SIZE / 2;
const CY = SIZE / 2;

export interface GlobeLiveProps {
  origin: Point;
  destination: Point;
  originLabel: string;
  destinationLabel: string;
}

export function GlobeLive({ origin, destination, originLabel, destinationLabel }: GlobeLiveProps) {
  const reduceMotion = useReducedMotion();
  const km = useMemo(() => distanceKm(origin, destination), [origin, destination]);
  const start = useMemo(() => initialView(origin, destination, km, SIZE, DISC), [origin, destination, km]);

  const [yaw, setYaw] = useState(start.yaw);
  const [pitch, setPitch] = useState(start.pitch);
  const [zoom, setZoom] = useState(start.zoom);
  const [spinning, setSpinning] = useState(true);
  const [progress, setProgress] = useState(1);
  const dragging = useRef<{ x: number; y: number; yaw: number; pitch: number; velocity: number } | null>(null);
  const coast = useRef(0);
  const frame = useRef<number | null>(null);
  const phase = useRef(0);
  /** Once the visitor has taken hold of the planet it stops moving on its own. */
  const touched = useRef(false);

  // Intro: pull the route into view, then draw the flight. Skipped for reduced motion.
  useEffect(() => {
    if (reduceMotion) {
      setZoom(start.zoom);
      setProgress(1);
      return;
    }
    setZoom(start.zoom * 0.6);
    setProgress(0);
    let raf = 0;
    let begin = 0;
    const DURATION = 1500;
    const step = (now: number) => {
      if (!begin) begin = now;
      const t = Math.min(1, (now - begin) / DURATION);
      // easeOutCubic: the flight leaves quickly and settles into the destination.
      setProgress(1 - (1 - t) ** 3);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    const zoomIn = window.setTimeout(() => setZoom(start.zoom), 60);
    const draw = window.setTimeout(() => {
      raf = requestAnimationFrame(step);
    }, 260);
    return () => {
      window.clearTimeout(zoomIn);
      window.clearTimeout(draw);
      cancelAnimationFrame(raf);
    };
  }, [start.zoom, reduceMotion]);

  /**
   * One rAF loop for all idle motion.
   *
   * Idle is a slow *sway* around the route (±10°), not a full orbit: a globe that keeps turning
   * after a few seconds would carry the flight off the disc and turn the map into decoration. The
   * sway shows that the sphere is real and draggable while keeping both airports in frame; a drag
   * takes over completely and coasts to rest, and the reset button puts the route back.
   */
  useEffect(() => {
    if (reduceMotion) return;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(now - last, 96) / 1000;
      last = now;
      if (document.visibilityState === "visible" && !dragging.current) {
        if (Math.abs(coast.current) > 0.05) {
          setYaw((value) => value + coast.current * delta);
          coast.current *= 0.93;
        } else if (!touched.current) {
          if (!spinning) {
            frame.current = requestAnimationFrame(tick);
            return;
          }
          phase.current += delta;
          setYaw(start.yaw + Math.sin(phase.current * 0.55) * 10);
        }
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [reduceMotion, spinning, start.yaw]);

  const options = { yaw, pitch, radius: DISC * zoom, cx: CX, cy: CY };
  const land = projectLand(LANDS, options);
  const grid = projectGraticule(options, 20);
  const route = projectRoute(origin, destination, options);

  // The arc is revealed along its own length: `progress` decides how many samples are shown.
  const visibleCount = Math.max(2, Math.round(route.points.length * progress));
  const arcSegments = splitArc(route.points.slice(0, visibleCount), route.hidden.slice(0, visibleCount));
  const arrived = progress >= 1;

  const heading = Math.round(bearing(origin, destination));

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (reduceMotion) return;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    dragging.current = { x: event.clientX, y: event.clientY, yaw, pitch, velocity: 0 };
    coast.current = 0;
    touched.current = true;
    phase.current = 0;
  }
  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragging.current;
    if (!drag) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    // A full drag across the disc is roughly a half turn; vertically the same gesture tilts the
    // camera, which is what makes the sphere read as an object rather than a spinning picture.
    const degrees = (deltaX / DISC) * 90;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.velocity = degrees * 60;
    setYaw(drag.yaw + degrees);
    setPitch((value) => Math.max(-70, Math.min(70, value - deltaY * 0.35)));
    drag.yaw += degrees;
  }
  function onPointerUp() {
    if (!dragging.current) return;
    coast.current = dragging.current.velocity;
    dragging.current = null;
  }

  function reset() {
    touched.current = false;
    phase.current = 0;
    setYaw(start.yaw);
    setPitch(start.pitch);
    setZoom(start.zoom);
    setProgress(0);
    window.setTimeout(() => setProgress(1), 120);
  }

  return (
    <figure className="relative" data-testid="route-globe" data-globe="live">
      <div className="relative mx-auto aspect-square w-full max-w-[21rem]">
        <motion.div
          className="absolute inset-0 rounded-full"
          initial={false}
          animate={{ scale: reduceMotion ? 1 : 1, opacity: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className={cn("h-auto w-full overflow-visible", !reduceMotion && "cursor-grab active:cursor-grabbing")}
            role="img"
            aria-label={`کرهٔ زمین سه‌بعدی با مسیر ${originLabel} به ${destinationLabel}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <title>{`مسیر ${originLabel} → ${destinationLabel} روی کرهٔ زمین`}</title>
            <defs>
              <radialGradient id="live-ocean" cx="34%" cy="26%" r="82%">
                <stop offset="0%" stopColor="#f6fdfc" />
                <stop offset="44%" stopColor="#e0f2ef" />
                <stop offset="80%" stopColor="#c0ded9" />
                <stop offset="100%" stopColor="#93c2ba" />
              </radialGradient>
              <radialGradient id="live-shade" cx="32%" cy="24%" r="88%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
                <stop offset="44%" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="100%" stopColor="#04231f" stopOpacity="0.33" />
              </radialGradient>
              <linearGradient id="live-arc" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#0f8a78" />
                <stop offset="100%" stopColor="#b45309" />
              </linearGradient>
              <clipPath id="live-clip">
                <circle cx={CX} cy={CY} r={DISC} />
              </clipPath>
              <filter id="live-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2.4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <circle cx={CX} cy={CY} r={DISC} fill="url(#live-ocean)" />

            <g clipPath="url(#live-clip)">
              {grid.length > 0 && (
                <path
                  d={grid.join("")}
                  fill="none"
                  stroke="#0a4d47"
                  strokeOpacity="0.12"
                  strokeWidth="0.55"
                />
              )}

              {land.map((path, index) => (
                <path
                  key={index}
                  d={path}
                  fill="#6cb4ab"
                  stroke="#0a4d47"
                  strokeOpacity="0.32"
                  strokeWidth="0.55"
                />
              ))}

              {/* The great circle, drawn in two passes: a white halo, then the gradient line. */}
              {arcSegments.map((d, index) => (
                <path key={`halo-${index}`} d={d} fill="none" stroke="#ffffff" strokeOpacity="0.9" strokeWidth="7" strokeLinecap="round" />
              ))}
              {arcSegments.map((d, index) => (
                <path
                  key={`arc-${index}`}
                  d={d}
                  fill="none"
                  stroke="url(#live-arc)"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  strokeDasharray="9 6"
                  filter="url(#live-glow)"
                />
              ))}

              {/* A plane that rides the drawn part of the arc — the flight, not a blinking dot. */}
              {(() => {
                const at = route.points[Math.min(visibleCount - 1, route.points.length - 1)];
                const before = route.points[Math.max(0, visibleCount - 2)];
                if (!at || !before || !arrived) return null;
                const angle = (Math.atan2(at[1] - before[1], at[0] - before[0]) * 180) / Math.PI;
                return <PlaneMarker at={at} angle={angle} />;
              })()}

              {route.origin && <Endpoint at={route.origin} tone="#0f8a78" label={originLabel} align="start" />}
              {route.destination && (
                <Endpoint at={route.destination} tone="#b45309" label={destinationLabel} align="end" />
              )}
            </g>

            <circle cx={CX} cy={CY} r={DISC} fill="url(#live-shade)" pointerEvents="none" />
            <circle cx={CX} cy={CY} r={DISC} fill="none" stroke="#0d6b60" strokeOpacity="0.34" pointerEvents="none" />
          </svg>
        </motion.div>

        {/* Controls sit over the disc but never block the drag area. */}
        {!reduceMotion && (
          <div className="absolute bottom-1 left-1 flex items-center gap-1.5">
            <GlobeButton
              onClick={() => setSpinning((value) => !value)}
              label={spinning ? "توقف چرخش" : "چرخش خودکار"}
              testId="globe-spin"
            >
              {spinning ? <Pause className="size-3.5" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
            </GlobeButton>
            <GlobeButton onClick={reset} label="بازگشت به نمای مسیر" testId="globe-reset">
              <RotateCcw className="size-3.5" aria-hidden="true" />
            </GlobeButton>
          </div>
        )}
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
          {reduceMotion
            ? "نمای تقریبی و بزرگ‌نمایی‌شده؛ مرکز کره وسط مسیر است."
            : "با کشیدن، کره را بچرخانید؛ پرواز روی دایرة‌المعارف بزرگ کشیده شده است."}
        </p>
      </figcaption>
    </figure>
  );
}

/** Split the projected arc where it dips behind the horizon, so no chord crosses the disc. */
function splitArc(points: Point[], hidden: boolean[]): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  for (let index = 0; index < points.length; index += 1) {
    if (hidden[index]) {
      if (current.length > 1) segments.push(`M${current.join("L")}`);
      current = [];
      continue;
    }
    const [x, y] = points[index]!;
    current.push(`${x} ${y}`);
  }
  if (current.length > 1) segments.push(`M${current.join("L")}`);
  return segments;
}

function PlaneMarker({ at, angle }: { at: Point; angle: number }) {
  return (
    <g transform={`translate(${at[0]} ${at[1]}) rotate(${angle})`} style={{ pointerEvents: "none" }}>
      <circle r="8" fill="#0f8a78" fillOpacity="0.16" />
      <path
        d="M7 0L-4 4.4L-1.6 0L-4 -4.4Z"
        fill="#0b1424"
        stroke="#ffffff"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </g>
  );
}

function Endpoint({
  at,
  tone,
  label,
  align,
}: {
  at: Point;
  tone: string;
  label: string;
  align: "start" | "end";
}) {
  const [x, y] = at;
  const dx = align === "start" ? 9 : -9;
  return (
    <g>
      <circle cx={x} cy={y} r="10" fill={tone} fillOpacity="0.16" />
      <circle cx={x} cy={y} r="4.4" fill={tone} stroke="#fff" strokeWidth="1.7" />
      <text
        x={x + dx}
        y={y + 3.5}
        textAnchor={align === "start" ? "start" : "end"}
        fontSize="9"
        fontWeight="700"
        fill={align === "start" ? "#0a4d47" : "#92400e"}
        stroke="#ffffff"
        strokeWidth="2.6"
        paintOrder="stroke"
        strokeLinejoin="round"
        style={{ fontFamily: "var(--font-sans), system-ui, sans-serif" }}
      >
        {label}
      </text>
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
